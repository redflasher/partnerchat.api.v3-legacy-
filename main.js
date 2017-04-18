require('dotenv').config();
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var socketAck = require("./ack.js");
socketAck.init(io);
var db = require("partner-db");

var colors = require('colors/safe');
var validator = require('validator');

require( "console-stamp" )( console, { pattern : "dd/mm/yyyy HH:MM:ss.l" } );

//INFO: для отправки подтверждений из файла index.js(db),
// сразу, минуя отправки задачи в очередь, получения ответа и т.д.
exports.sendAckToWSClient = sendAckToWSClient;

var redis = require("redis");
//Redis client
var redisClient = redis.createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASS
});

redisClient.on('error', function (err) {
    console.log( colors.red("index.redis.on.error:", err) );
});

redisClient.on("connect", function () {
    console.log( colors.green("main: redis is connected") );
});


//RabbitMQ

var infoMessagesHandlerRabbit = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit2 = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit3 = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);


infoMessagesHandlerRabbit.then(function(connection) {
    var ok = connection.createChannel();

    ok.then(function(channel) {
        channel.assertQueue("infosMessages");
        channel.assertExchange("info");
        channel.bindQueue("infoMessages", "info", "mda");

        channel.consume("infoMessages", function(message) {
            var jsonDataString = message.content.toString();
            var jsonData = JSON.parse(jsonDataString);
            sendInfoMessageToWSClient(jsonData);
            channel.ack(message);
        });
    });

    return ok;
}).then(null, console.log);


rabbit.then(function(connection) {
    var ok = connection.createChannel();

    ok.then(function(channel) {
        // durable: true is set by default
        channel.assertQueue("acksMessages");
        channel.assertExchange("acks");
        channel.bindQueue("acksMessages", "acks", "mda");

        channel.consume("acksMessages", function(message) {

            var jsonData = {};

            if(!message) {
                console.log(colors.red("main.acksMessages.error(1)"));
                channel.ack(message);
                jsonData.status="error";
                sendAckToWSClient(jsonData);
                return false;
            }
            var jsonDataString = message.content.toString();
            jsonData = JSON.parse(jsonDataString);

            if(jsonData.status == "ok") {
                sendAckToWSClient(jsonData);
                channel.ack(message);
            } else if(jsonData.status == "error") {
                sendAckToWSClient(jsonData);
                channel.ack(message);
            } else {
                console.log( colors.red("unhandle situation"), jsonData );
                channel.ack(message);
            }

        });
    });

    return ok;
}).then(null, console.log);


/********************SEND WS MESSAGES*********************/
rabbit3.then(function(connection) {
    var ok = connection.createChannel();

    ok.then(function(channel) {
        // durable: true is set by default
        channel.assertQueue("ws");
        channel.assertExchange("ws_exchange");
        channel.bindQueue("ws", "ws_exchange", "mda");

        channel.consume("ws", function(message) {
            var jsonDataString = message.content.toString();
            var jsonData = JSON.parse(jsonDataString);

            var jData = {};
            jData.socketId = jsonData.socketId;
            jData.action = "ws.incoming.messages";
            jData.info = {alert:jsonData.message, assetId: jsonData.assetId};

            sendInfoMessageToWSClient(jData);
            channel.ack(message);
        });
    });

    return ok;
}).then(null, console.log);
/*********************END WS MESSAGES*********************/


//init
db.init();

//date fix polyfil
if (!Date.now) {
    Date.now = function now() {
        return new Date().getTime();
    };
}


app.get('/', function(req, res){
  res.sendfile('index.html');
});

var count = 0;
io.on('connection', function(socket) {
    count++;
    console.log('a user connected. count='+count +" "+socket.id);

    console.log("ip: "+socket.request.connection.remoteAddress);
    console.log("user-agent: "+socket.request.headers['user-agent']);

    socket.on('disconnect', function () {
        count--;
        console.log('user disconnected. count='+count + " "+socket.id);
        
        //добавляем юзера в список "онлайн" в редис. для отправки в дальнейшем ему ws-сообщений
        redisClient.hget("online", socket.id, function(err, redisUserId) {
            redisClient.hdel("online", socket.id, function (er, repl) {});
            redisClient.hdel("online", redisUserId, function (er, repl) {});
            //add to offline (key - user_id, value - last updated time)

            redisClient.hget("id2phone", redisUserId, function(er2, userPhone) {
                if(er2) {}
                else {
                    var last_time_persistent = Date.now();
                    redisClient.hset("offline", userPhone, last_time_persistent);
                }
            });
        });

    });

	socket.on("ack", function(sockData) {
			console.log( colors.green("c->s: ack connection"), sockData);
	});
    
	socket.on("authPhone", function(sockData) {

        var jData = {};

        //INPUT VALIDATION
        if( !sockData.requestId || !validator.isNumeric(sockData.requestId.toString())
            || sockData.requestId == undefined ) {
            jData.status = "error";
            jData.error = "wrong_request_id";
            jData.action = "authPhone";
            jData.socketId = socket.id;
            sendAckToWSClient(jData);
            return false;
        }

        sockData.action = "authPhone";
        sockData.socketId = socket.id;

        console.log("authPhone.sockData", sockData);
        db.authPhone(sockData);
	});

	socket.on("authSms", function(sockData) {

        var jData = {};

        sockData.socketId = socket.id;
        sockData.action = "authSms";

        //INPUT VALIDATION
        if( validator.isNumeric(sockData.phone.toString()) ){}
        else {
            socketAck.regPhoneAck("error","wrong_phone", sockData.socketId, sockData.requestId);
            return false;
        }


        if( !sockData.requestId || !validator.isNumeric(sockData.requestId.toString())
            || sockData.requestId == undefined ) {
            jData.status = "error";
            jData.error = "wrong_request_id";

            jData.action = "authSms";
            jData.socketId = socket.id;
            sendAckToWSClient(jData);
            return false;
        }

        db.authSms(sockData.phone, sockData.code, function(data) {

            console.log(data);

            if(data.status == "error") {
                socketAck.authSmsAck("error", data.error, sockData.socketId, sockData.requestId);
            } else if(data.status == "ok") {
                //отправляем токен авторизации пользователю
                socketAck.authSmsAck("ok", null, sockData.socketId, sockData.requestId);
                try {
                    var userDataInfo = JSON.parse(data.info);
                    delete userDataInfo['user_id'];
                    sendTokenAndUserdata(sockData.socketId, userDataInfo);
                } catch(e) {
                    console.error(e, data);
                }

            }
        });
	});


    // если телефона нет - отправляем юзеру смс на этот номер.
    // одновременно с отправкой смс создаем запись в таблице users о новом пользователе (указываем только phone)
    // создание нового юзера нужно для получения id юзера, которое затем и будет задано как asset_id_in_partner
    // для актива юзера-отправителя (и для всех последующих юзеров, кто захочет создать себе такого партнера и
    // отправить ему запрос на получение или списание средств)
    socket.on("addAsset", function (sockData) {
        sockData.action = "addAsset";
        sockData.socketId = socket.id;
        db.addAsset(sockData);
    });

	socket.on("getAssets", function(sockData) {
        sockData.action = "getAssets";
        sockData.socketId = socket.id;
        db.getAssets(sockData);
	});

	socket.on("getAssetHistory", function(sockData) {
        sockData.action = "getAssetHistory";
        sockData.socketId = socket.id;
        sockData.offset = sockData.offset || 0;
        db.getAssetHistory(sockData);
	});

    socket.on("renameAsset", function (sockData) {
        sockData.socketId = socket.id;
        sockData.action = "renameAsset";
        db.renameAsset(sockData);
    });

    socket.on("deleteAsset", function (sockData) {
        sockData.action = "deleteAsset";
        sockData.socketId = socket.id;
        db.deleteAsset(sockData);
    });

    /***************TRANSFER ZONE********************/
    socket.on("transfer", function (sockData) {
        sockData.action = "transfer";
        sockData.socketId = socket.id;
        db.transfer(sockData);
    });

    socket.on("declineTransfer", function(sockData) {
        sockData.action = "declineTransfer";
        sockData.socketId = socket.id;
        db.declineTransfer(sockData);
    });

    socket.on("acceptTransfer", function(sockData) {
        sockData.action = "acceptTransfer";
        sockData.socketId = socket.id;
        db.acceptTransfer(sockData);
    });

    /************END TRANSFER ZONE********************/

    /*******************PROFILE ZONE******************/
    socket.on("setProfile", function(sockData) {
        sockData.action = "setProfile";
        sockData.socketId = socket.id;
        db.setProfile(sockData);
    });

    socket.on("getProfile", function(sockData) {
        sockData.action = "getProfile";
        sockData.socketId = socket.id;
        db.getProfile(sockData);
    });
    /****************END PROFILE ZONE*****************/


    /***************SET PUSH TOKEN********************/
    socket.on("setPushToken", function(sockData) {
        sockData.action = "setPushToken";
        sockData.socketId = socket.id;
        db.setPushToken(sockData);
    });
    /************END SET PUSH TOKEN********************/


    /***************SET SALDO ZONE********************/
    socket.on("setSaldo", function (sockData) {
        console.log("setSaldo", sockData);
        sockData.action = "setSaldo";
        sockData.socketId = socket.id;
        db.setSaldo(sockData);
    });

    socket.on("acceptNewSaldo", function(sockData) {
        sockData.action = "acceptNewSaldo";
        sockData.socketId = socket.id;
        db.acceptNewSaldo(sockData);
    });

    socket.on("declineNewSaldo", function(sockData) {
        sockData.action = "declineNewSaldo";
        sockData.socketId = socket.id;
        db.declineNewSaldo(sockData);
    });
    /************END SET SALDO ZONE********************/

    /*************STATUS ZONE**************************/
    socket.on("ionline", function(sockData) {
        sockData.action = "ionline";
        sockData.socketId = socket.id;
        console.log("on.ionline", sockData);
        db.ionline(sockData);
    });
    /************END STATUS ZONE***********************/

    /***************TEMPORARY ASSET ZONE******************/
    socket.on("transferFromTemporaryAsset2Asset", function(sockData) {
        sockData.action = "transferFromTemporaryAsset2Asset";
        sockData.socketId = socket.id;
        db.transferFromTemporaryAsset2Asset(sockData);
    });

    socket.on("deleteFromTemporaryAsset", function(sockData) {
        sockData.action = "deleteFromTemporaryAsset";
        sockData.socketId = socket.id;
        db.deleteFromTemporaryAsset(sockData);
    });
    /**************END TEMPORARY ASSET ZONE***************/

    /*****************GOODS ZONE**************************/
    socket.on("updateGoods", function(sockData) {
        sockData.action = "updateGoods";
        sockData.socketId = socket.id;
        db.updateGoods(sockData);
    });
    /*******************END GOODS ZONE********************/
    
    /*************DELETE TRANSACTIONS HISTORY*************/
    socket.on("deleteTransactionsHistory", function (sockData) {
        sockData.action = "deleteTransactionsHistory";
        sockData.socketId = socket.id;
        db.deleteTransactionsHistory(sockData);
    });
    /**********END DELETE TRANSACTIONS HISTORY************/


    /***************DELETE ACCOUNT ***********************/
    socket.on("deleteAccount", function (sockData) {
        sockData.action = "deleteAccount";
        sockData.socketId = socket.id;
        db.deleteAccount(sockData);
    });
    /***************END DELETE ACCOUNT********************/



});//end io.on.connections

function sendTokenAndUserdata(socketId, userData) {
    io.sockets.connected[socketId].emit("setToken", {status:"ok", info:userData });
}

/**
 * функция шлет информационное сообщение и не шлет подтверждение.
 * @param jsonData
 * @param jsonData.socketId
 * @param jsonData.action
 * @param jsonData.info
 *
 */
function sendInfoMessageToWSClient(jsonData) {

    if(jsonData.socketId) {
        if(Object.keys(io.sockets.sockets).length == 0 ) {
            console.log( colors.red("main.sendInfoMessageToWSClient.error: 'socket is not found'"));
            return false;
        }

        // INFO: Возможное критическое место(!)
        if(!io.sockets.connected[jsonData.socketId]) {
            setTimeout(function () {
                    console.log( colors.red("main.sendInfoMessageToWSClient.error: '(2)socket is not found'"));
                },
                1000);
            return false;
        }
        io.sockets.connected[jsonData.socketId].emit(jsonData.action, {info: jsonData.info});
    } else {
        console.log( colors.red("main.sendInfoMessageToWSClient.error: 'not found ws-socket id'") );
    }

}


//функция возвращает подтверждение ws-клиенту. вызывается после ответа воркера через очередь
function sendAckToWSClient(jsonData) {

    console.log("main.sendAckToWSClient", jsonData);

    switch(jsonData.action) {

        case "authPhone": {
            socketAck.authPhoneAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "authSms": {
            socketAck.authSmsAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "getAssets": {
            socketAck.getAssetsAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }
        case "getAssetHistory": {
            socketAck.getAssetHistoryAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "addAsset": {
            socketAck.addAssetAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }
        case "renameAsset": {
            socketAck.renameAssetAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }
        case "deleteAsset": {
            socketAck.deleteAssetAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "transfer": {
            socketAck.transferAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "declineTransfer": {
            socketAck.declineTransferAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "acceptTransfer": {
            socketAck.acceptTransferAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "setProfile": {
            socketAck.setProfileAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "getProfile": {
            socketAck.getProfileAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "setPushToken": {
            socketAck.setPushTokenAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "setSaldo": {
            socketAck.setSaldoAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "acceptNewSaldo": {
            socketAck.acceptNewSaldoAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "declineNewSaldo": {
            socketAck.declineNewSaldoAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "ionline": {
            socketAck.ionlineAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "transferFromTemporaryAsset2Asset": {
            socketAck.transferFromTemporaryAsset2AssetAck(jsonData.status, jsonData.error, jsonData.socketId
                , jsonData.requestId);
            break;
        }

        case "deleteFromTemporaryAsset": {
            socketAck.deleteFromTemporaryAssetAck(jsonData.status, jsonData.error, jsonData.socketId
                , jsonData.requestId);
            break;
        }

        case "updateGoods": {
            socketAck.updateGoodsAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        case "deleteTransactionsHistory": {
            socketAck.deleteTransactionsHistoryAck(jsonData.status, jsonData.error, jsonData.socketId
                , jsonData.requestId);
            break;
        }

        case "deleteAccount": {
            socketAck.deleteAccountAck(jsonData.status, jsonData.error, jsonData.socketId, jsonData.requestId);
            break;
        }

        default: {
            console.log( colors.red("no case ack! ", jsonData.action ));
        }
        //INFO: здесь добавлять новые case при добавлении каждого нового метода API
    }
}

http.listen(process.env.WS_LISTEN_PORT, function(){
  console.log('listening on *:3000');
});