require('dotenv').config();
//db=mysql - один возможных вариантов
var mysql      = require('mysql');
var mysqlConnection, pool;
var sha1 = require('sha1');

var colors = require('colors/safe');

var redis = require("redis");
var redisClient;

var request = require('request');
//APNs push
var apn = require("apn");

//GCMs push
// var gcm = require('node-gcm');
// var sender = new gcm.Sender(process.env.GCM_API_KEY);
// var regTokens = ['YOUR_REG_TOKEN_HERE'];
//
// sender.send(message, { registrationTokens: regTokens }, function (err, response) {
//     if(err) console.error(err);
//     else 	console.log(response);
// });



require( "console-stamp" )( console, { pattern : "dd/mm/yyyy HH:MM:ss.l" } );


//START PUSH INIT BLOCK
var connOptions = {};

connOptions.cert = './apns-push-certs/cert.pem';
connOptions.key = './apns-push-certs/key.pem';
connOptions.passphrase = process.env.APN_CERT_PASS;
connOptions.production = true;
connOptions.batchFeedback = true;

console.log(connOptions);

// Создаём подключение к APNS
var apnConn = new apn.Connection(connOptions);
apnConn.on("error", function(error){
   console.error("worker.apnConn.error", error);
});
apnConn.on("socketError", function(error){
    console.error("worker.apnConn.socketError", error);
});



//mysql config
var db_config = {
    host     : process.env.DB_HOST,
    user     : process.env.DB_USER,
    password : process.env.DB_PASS,
    database : process.env.DB_DATABASE,
    charset: 'utf8mb4'
};

var note = new apn.Notification();
//END PUSH INIT BLOCK


function init(cb) {

    handleDisconnect();

    //Redis init
    redisClient = redis.createClient({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASS
    });

    redisClient.on('error', function (err) {
        console.log( colors.red("worker.redis.on.error:", err) );
    });

    redisClient.on("connect", function () {
        console.log( colors.green("worker: redis is connected") );
    });

    console.log('db inited.');

  if(cb)cb();
}
init();


function handleDisconnect() {
    console.log("handleDisconnect");

    mysqlConnection = mysql.createConnection(db_config); // Recreate the connection, since
                                                    // the old one cannot be reused.

    mysqlConnection.connect(function(err) {              // The server is either down
        if(err) {                                     // or restarting (takes a while sometimes).
            console.log('error when connecting to db:', err);
            setTimeout(handleDisconnect, 2000); // We introduce a delay before attempting to reconnect,
        }                                     // to avoid a hot loop, and to allow our node script to
    });                                     // process asynchronous requests in the meantime.
                                            // If you're also serving http, display a 503 error.
    mysqlConnection.on('error', function(err) {
        console.log('db error', err);
        if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
            handleDisconnect();                         // lost due to either server restart, or a
        } else {                                      // connnection idle timeout (the wait_timeout
            console.error(err);                                  // server variable configures this)
        }
    });
}

var rabbit = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit2 = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit3 = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit4 = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var rabbit5 = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+//for sms
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

//worker for single mysql-queries
rabbit.then(function(connection) {
    var ok = connection.createChannel();

    ok.then(function(channel) {
        // durable: true is set by default
        channel.assertQueue("messages");
        channel.assertExchange("incoming");
        channel.bindQueue("messages", "incoming", "mda");

        channel.consume("messages", function(message) {

            if(!message) {
                console.log(colors.red("dbWorker.messages.error(1)"));
                channel.ack(message);
                return false;
            }

            var jsonDataString = message.content.toString();
            var jsonData = JSON.parse(jsonDataString);

            //for acks
            var jDataAck = {};
            jDataAck.socketId = jsonData.socketId;

            //для создания партнера используется более сложная, не стандартная конструкция
            // поэтому здесь добавлена проверка на метод "addAsset", assetType="partner"
            console.log("called ", jsonData.action, jsonData.requestId);

            //добавляем requestId для подтверждений к клиенту
            var jData = {};
            jData.requestId = jDataAck.requestId = jsonData.requestId;

            switch(jsonData.action) {

                case "addAsset": {
                    jDataAck.action = "addAsset";
                    if(jsonData.type == "partner") {

                        startTransaction();
                        addPartnerStep1(jsonData, function (status, insertId) {
                            channel.ack(message);

                            sendAckToServer(jDataAck, status);

                            if(status == "ok") {
                                commitTransaction();
                            } else if(status == "error") {
                                rollbackTransaction();
                                sendAckToServer(jDataAck, "error");
                                return false;
                            }

                            jData.insertId = insertId;
                            jData.info = {insertId: insertId, requestId: jsonData.requestId};
                            jData.action = "addAsset";
                            jData.socketId = jsonData.socketId;

                            sendMessageToServer(jData);//TODO: протестировать. добавлен возврат id пользователю
                        });
                    } else if(jsonData.type == "asset") {
                        startTransaction();
                        mysqlPoolSelectQuery(jsonData.query, function(rowsOrStatus, err) {
                            if (err) {
                                console.log( colors.red("dbWorker.error 1: "), err.code, colors.cyan(jsonData.query));
                                channel.ack(message);

                                rollbackTransaction();
                                sendAckToServer(jDataAck, "error");
                                return false;
                            } else {
                                channel.ack(message);

                                commitTransaction();
                                sendAckToServer(jDataAck, "ok");

                                jData.info = {insertId: rowsOrStatus.insertId, requestId: jsonData.requestId};
                                jData.action = "addAsset";
                                jData.socketId = jsonData.socketId;

                                sendMessageToServer(jData);
                            }
                        });
                    }
                    break;
                }

                case "deleteAsset": {

                    jDataAck.action = "deleteAsset";
                    startTransaction();

                    var q1 = "SELECT type FROM assets WHERE id="+jsonData.assetId + " AND user_id="+
                        jsonData.user_id+" LIMIT 1";
                    mysqlPoolSelectQuery(q1, function(rows, err) {
                        if (err) {
                            console.log( colors.red("dbWorker.error 2: "), err.code, colors.cyan("deleteAsset"),
                            colors.gray(q1));
                            channel.ack(message);
                            rollbackTransaction();
                            jDataAck.error = "wrong_asset_id";
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {

                            //INFO: проверяем, не пытается ли юзер удалить временный актив
                            var q_1 = "SELECT name FROM assets WHERE id="+jsonData.assetId+" AND user_id=" +
                                jsonData.user_id+" AND name='temporary_asset'";

                            mysqlPoolSelectQuery(q_1, function (rows_1, err_1) {
                               if(err_1) {
                                   channel.ack(message);
                                   rollbackTransaction();
                                   sendAckToServer(jDataAck, "error");
                                   return false;
                               } else if(rows_1.length > 0) {

                                   //попытка удалить временный актив
                                   channel.ack(message);
                                   rollbackTransaction();
                                   jDataAck.error = "it_is_temporary_asset";
                                   sendAckToServer(jDataAck, "error");
                                   return false;
                               } else {
                                   //все ок
                                   channel.ack(message);

                                   if(rows == [] || rows[0] == undefined) {
                                       rollbackTransaction();
                                       jDataAck.error = "wrong_asset_id";
                                       sendAckToServer(jDataAck, "error");
                                       return false;
                                   }

                                   if(rows[0].type == "asset") {
                                       var q2 = 'DELETE LOW_PRIORITY FROM assets WHERE id='+jsonData.assetId+
                                           " AND user_id="+jsonData.user_id;
                                       mysqlPoolQuery(q2, function(status2) {

                                           if(status2 == "ok") {

                                               //INFO: удаляем историю действий с данным активом
                                               var q3 = 'DELETE LOW_PRIORITY FROM actions WHERE asset_id='+
                                                   jsonData.assetId+" AND status !='PENDING'";
                                               mysqlPoolQuery(q3, function (status3) {

                                                   if(status3 == "ok") {
                                                       commitTransaction();
                                                   } else {
                                                       rollbackTransaction("del.1");
                                                   }

                                               });

                                           } else if(status2 == "error") {
                                               rollbackTransaction();
                                               sendAckToServer(jDataAck, "error");
                                               return false;
                                           }

                                           sendAckToServer(jDataAck, status2);
                                       });
                                   } else if(rows[0].type == "partner") {
                                       var q3 = 'UPDATE assets SET is_visible=0 WHERE id='+jsonData.assetId +
                                           " AND user_id="+jsonData.user_id;
                                       mysqlPoolQuery(q3, function(status3) {

                                           if(status3 == "ok") {
                                               commitTransaction();
                                           } else if(status3 == "error") {
                                               rollbackTransaction();
                                               sendAckToServer(jDataAck, "error");
                                               return false;
                                           }

                                           sendAckToServer(jDataAck, status3);
                                       });
                                   } else if(rows[0].type == "cost") {
                                       //подход устарел. такого типа более не существует
                                       // (cost внесен как доп. поле в бд is_cost
                                   } else {
                                       rollbackTransaction();
                                       sendAckToServer(jDataAck, "error");
                                       return false;
                                   }
                               }
                            });
                        }
                    });
                    break;
                }

                case "renameAsset": {
                    console.log( colors.green("renameAsset case") );

                    jDataAck.action = "renameAsset";

                    startTransaction();

                    //блокировка переименовывания "временного счета"
                    var q_0 = "SELECT name FROM assets WHERE id="+jsonData.assetId+" AND name='temporary_asset'" +
                        " LIMIT 1";
                    mysqlPoolSelectQuery(q_0, function (rows_0, err) {
                       if(err) {
                           channel.ack(message);

                           rollbackTransaction();

                           jDataAck.error = err;
                           sendAckToServer(jDataAck, "error");
                           return false;
                       } else if(rows_0.length > 0) {
                           channel.ack(message);

                           rollbackTransaction();

                           jDataAck.error = "it_is_temporary_asset";
                           sendAckToServer(jDataAck, "error");
                           return false;
                       } else {
                           //если все ок

                           channel.ack(message);

                           mysqlPoolSelectQuery(jsonData.query, function(rowsOrStatus, err) {
                               if (err) {
                                   console.log( colors.red("dbWorker.case.renameAsset.error: "), err.code,
                                       colors.cyan(jsonData.query));

                                   rollbackTransaction();
                                   // 2 - отправка сообщения в др. очередь
                                   // сообщение о том, с каким результатом была выполнена операция(ok или error)
                                   sendAckToServer(jDataAck, "error");
                                   return false;
                               } else {
                                   //если не было обновлено ни одного актива (указан не суещствующий asset id
                                   if( rowsOrStatus.affectedRows == 0 ) {

                                       rollbackTransaction();
                                       // здесь 1 - отправка подтверждения,
                                       // 2 - отправка сообщения в др. очередь
                                       // сообщение о том, с каким результатом была выполнена операция(ok или error)
                                       jDataAck.error = "asset_id_not_found";
                                       sendAckToServer(jDataAck, "error");
                                       return false;
                                   } else {
                                       commitTransaction();
                                       sendAckToServer(jDataAck, "ok");
                                   }
                               }
                           });
                       }
                    });

                    break;
                }

                case "getAssets": {

                    jDataAck.action = "getAssets";

                    getUserAssets(jsonData, function (assetsList, errorInfo) {
                        channel.ack(message);

                        if(assetsList == "error") {
                            jDataAck.error = errorInfo;
                            sendAckToServer(jDataAck, "error");
                            return false;
                        }
                        else sendAckToServer(jDataAck, "ok");

                        jData.info = assetsList;
                        jData.action = "getAssets";
                        jData.socketId = jsonData.socketId;

                        sendMessageToServer(jData);
                    });
                    break;
                }

                case "authPhone": {
                    console.log(colors.green("authPhone case"));
                    jDataAck.action = "authPhone";
                    //проверяем существование юзера с заданным номером телефона в кэше (и, если надо, в mysql)
                    redisClient.hget("users", jsonData.phone, function (err, reply) {

                        console.log("authPhone.err: ", err, reply);

                        //если номера в кэше нет(кэш выдал ошибку или пустой результат) - делаем запрос к mysql
                        if(err || !reply) {

                            startTransaction();
                            //побуем найти юзера в mysql users (когда в кэше он не найден)
                            mysqlPoolSelectQuery(jsonData.query, function (rows, errorInfo) {
                                if(errorInfo) {
                                    channel.ack(message);
                                    rollbackTransaction();
                                    jDataAck.error = errorInfo;
                                    sendAckToServer(jDataAck, "error");
                                    return false;
                                }

                                jsonData.query = "";
                                if(rows.length == 0) {
                                    //если юзер не найден - сразу же регистрируем его.
                                    /****new regPhone****/
                                    var newToken = sha1(new Date().getTime());
                                    var q = 'INSERT INTO users (phone, token) ' +
                                        'VALUES("'+jsonData.phone+'","'+newToken+'")';

                                    mysqlPoolSelectQuery(q, function(rowsOrStatus, err) {
                                        if (err) {
                                            console.log( colors.red("dbWorker.authPhone.error 0: "),
                                                err.code, colors.cyan(jsonData.query), q);
                                            channel.ack(message);
                                            // 2 - отправка сообщения в др. очередь
                                            // сообщение о том, с каким результатом была выполнена операция
                                            // (ok или error)

                                            if(err.code == "ER_DUP_ENTRY") {
                                                rollbackTransaction();
                                                jDataAck.error = "user_already_exists";
                                                sendAckToServer(jDataAck, "error");
                                                return false;
                                            } else {
                                                rollbackTransaction();
                                                sendAckToServer(jDataAck, "error");
                                                return false;
                                            }
                                        } else {
                                            //добавлен новый юзер
                                            // добавляем ему 4 актива и 5 категорий расходов "по умолчанию"
                                            var userId = rowsOrStatus.insertId;
                                            var q2 = "INSERT INTO assets(user_id, name, type, is_cost, is_visible, " +
                                                "was_declined) " +
                                                "VALUES("+userId+", 'Банковская карта','asset', 0, 1, 0), " +
                                                "("+userId+", 'Кошелек','asset', 0, 1, 0), " +
                                                "("+userId+", 'Сбережения','asset', 0, 1, 0), " +
                                                "("+userId+", 'Склад','asset', 0, 1, 0), " +
                                                "("+userId+", 'Развлечения','asset', 1, 1, 0), " +
                                                "("+userId+", 'Дорога','asset', 1, 1, 0), " +
                                                "("+userId+", 'Семья','asset', 1, 1, 0), "+
                                                "("+userId+", 'temporary_asset','asset', 1, 0, 1)";

                                            mysqlPoolSelectQuery(q2, function(rowsOrStatus2, err2) {

                                                if (err) {
                                                    console.log( colors.red("dbWorker.error 0.1: "),
                                                        err.code, colors.cyan(jsonData.query));

                                                    rollbackTransaction();
                                                    channel.ack(message);
                                                    sendAckToServer(jDataAck, "error");
                                                    return false;
                                                } else {

                                                    // здесь 1 - отправка подтверждения,
                                                    channel.ack(message);

                                                    //2. обновляем redis-кэш
                                                    var userObj = {
                                                        id: rowsOrStatus.insertId,
                                                        name:"",
                                                        address:"",
                                                        business:"",
                                                        position:"",
                                                        requisites:"",
                                                        phone: jsonData.phone,
                                                        city:"",
                                                        company:"",
                                                        token:newToken
                                                    };

                                                    var jsonUserObj = JSON.stringify(userObj);

                                                    var jsonUserData = {
                                                        id: rowsOrStatus.insertId,
                                                        phone: jsonData.phone,
                                                        token:newToken
                                                    };

                                                    var jsonUserDataString = JSON.stringify(jsonUserData);

                                                    redisClient.hset("users", newToken,
                                                        jsonUserDataString);
                                                    redisClient.hset("users", jsonData.phone, jsonUserObj);

                                                    //3. Отправляем СМС
                                                    console.log(colors.green("добавлен новый юзер. шлем смс"));

                                                    var smsCode = Math.random().toString().substr(-6);
                                                    //smsCode = 999999;
                                                    // var jData = {};
                                                    jData.sms_code = smsCode;
                                                    jData.phone = jsonData.phone;
                                                    jData.msgType = "sms";
                                                    sendSmsTaskToQueue(jData);

                                                    var phoneTokenKey = jsonData.phone+":"+smsCode;

                                                    redisClient.hset("authPhoneSMS", phoneTokenKey, jsonUserObj);

                                                    // Возможно это узкое место в будущем.
                                                    setTimeout(function () {
                                                        redisClient.hdel("authPhoneSMS", phoneTokenKey,
                                                            function (er, repl) {
                                                                console.log(colors.green("sms-code " + smsCode +
                                                                    " was deleted."));
                                                            });
                                                    }, process.env.SMS_CODE_TIMEOUT);//300000мс 

                                                    // 4 - отправка сообщения в др. очередь
                                                    // сообщение о том, с каким результатом
                                                    // была выполнена операция(ok или error)
                                                    commitTransaction();

                                                    var regChatMsg = {};
                                                    regChatMsg.action = "addNewUser";
                                                    regChatMsg.login = jsonData.phone;
                                                    regChatMsg.password = newToken;
                                                    sendToChatQueue(regChatMsg);

                                                    sendAckToServer(jDataAck, "ok");
                                                }
                                            });



                                        }
                                    });
                                    /**end new regPhone**/

                                } else if(errorInfo) {
                                    rollbackTransaction();
                                    channel.ack(message);
                                    jDataAck.status = "error";
                                    sendAckToServer(jDataAck, "error");
                                    return false;
                                } else { //ok, в редисе юзер не найден, но в mysql найден.
                                    // случай после удаления и последующего восстановления пользователя
                                    channel.ack(message);
                                    commitTransaction();

                                    //записываем к redis-кэш номер телефона и соответствующий ему смс-код
                                    var smsCode = Math.random().toString().substr(-6);
                                    //smsCode = 999999;

                                    // var jData = {};
                                    jData.sms_code = smsCode;
                                    jData.phone = jsonData.phone;
                                    jData.msgType = "sms";
                                    sendSmsTaskToQueue(jData);

                                    //Записываем в кэш смс-код, чтобы затем по нему предоставить номер телефона,
                                    //а по нему, в свою очередь, токен и информацию о юзере

                                    var phoneTokenKey = jsonData.phone+":"+smsCode;
                                    redisClient.hset("authPhoneSMS", phoneTokenKey, rows[0].token);

                                    //TODO: протестировать это решение. Возможно это узкое место в будущем.
                                    setTimeout(function() {
                                        redisClient.hdel("authPhoneSMS", phoneTokenKey, function (er, repl) {
                                            //
                                        });
                                    }, process.env.SMS_CODE_TIMEOUT);//300000мс = 5мин. время жизни смс-кода



                                    //обновляем redis-кэш
                                    var newToken = sha1(new Date().getTime());
                                    var userObj = {
                                        id:  rows[0].id,
                                        phone: jsonData.phone,
                                        token:rows[0].token
                                    };

                                    var jsonUserObj = JSON.stringify(userObj);

                                    var jsonUserData = {
                                        id: rows[0].id,
                                        phone: jsonData.phone,
                                        token:rows[0].token
                                    };
                                    var jsonUserDataString = JSON.stringify(jsonUserData);

                                    redisClient.hset("users", rows[0].token, jsonUserDataString);
                                    redisClient.hset("users", jsonData.phone, jsonUserObj);


                                    sendAckToServer(jDataAck, "ok");
                                }
                            });
                        } else {
                            //если все ок, то:
                            // отправляем подтверждение серверу очередей
                            channel.ack(message);

                            //INFO: записываем в authPhoneSMS не только токен, но и инфу юзера
                            redisClient.hget("users", jsonData.phone, function(e, rplToken) {

                                //записываем к redis-кэш номер телефона и соответствующий ему смс-код
                                var smsCode = Math.random().toString().substr(-6);
                                //smsCode = 999999;//TODO: убрать это отсюда, когда будут слаться смс-ки

                                var userInfoData = JSON.parse(rplToken);

                                delete userInfoData['id'];
                                delete userInfoData['pushToken'];

                                var userInfoDataString = JSON.stringify(userInfoData);


                                var phoneTokenKey = jsonData.phone+":"+smsCode;
                                redisClient.hset("authPhoneSMS", phoneTokenKey, userInfoDataString);

                                // var jData = {};
                                jData.sms_code = smsCode;
                                jData.phone = jsonData.phone;
                                jData.msgType = "sms";
                                sendSmsTaskToQueue(jData);

                                //TODO: протестировать это решение. Возможно это узкое место в будущем.
                                setTimeout(function() {
                                    //записываем к redis-кэш номер телефона и соответствующий ему смс-код
                                    redisClient.hdel("authPhoneSMS", phoneTokenKey, function (er, repl) {
                                        //
                                    });
                                }, process.env.SMS_CODE_TIMEOUT);//300000мс = 5мин. время жизни смс-кода

                            });
                            // отправляем подтверждение ws-клиенту
                            sendAckToServer(jDataAck, "ok");
                        }
                    });
                    break;
                }

                case "getAssetHistory": {

                    jDataAck.action = "getAssetHistory";

                    getAssetHistory(jsonData, function (getAssetHistoryJsonData) {

                        channel.ack(message);
                        if(getAssetHistoryJsonData.status == "error") {
                            sendAckToServer(jDataAck, "error");
                            return false;
                        }
                        else sendAckToServer(jDataAck, "ok");

                        // var jData = {};
                        jData.info = getAssetHistoryJsonData;
                        jData.action = "getAssetHistory";
                        jData.socketId = jsonData.socketId;

                        sendMessageToServer(jData);
                    });
                    break;
                }

                case "getProfile": {

                    jDataAck.action = "getProfile";

                    mysqlPoolSelectQuery(jsonData.query, function (rows, errorInfo) {
                        if(errorInfo) {
                            channel.ack(message);

                            sendAckToServer(jDataAck, "error");
                            return false;
                        }
                        
                        jsonData.query = "";
                        if(rows.length == 0) {
                            channel.ack(message);
                            console.log( colors.red("getProfile.error(1): "), jsonData, errorInfo );
                            jDataAck.error = "profile_not_found";
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else if(errorInfo) {
                            channel.ack(message);
                            console.log( colors.red("getProfile.error(2): "), jsonData, errorInfo );
                            jDataAck.error = errorInfo;
                            jDataAck.status = "error";
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {
                            //ok

                            var _goods = [];
                            try {
                                _goods = JSON.parse(rows[0].goods);
                            } catch(ex) {
                                console.log("parse json error: ", ex);
                                _goods = [];
                            }

                            rows[0].goods = _goods;

                            var userProfile = rows[0] || rows || [];

                            channel.ack(message);
                            sendAckToServer(jDataAck, "ok");
                            // var jData = {};
                            jData.info = userProfile;
                            jData.action = "getProfile";
                            jData.socketId = jsonData.socketId;
                            sendMessageToServer(jData);
                        }

                    });
                    break;
                }

                case "setProfile": {

                    jDataAck.action = "setProfile";

                    startTransaction();

                    mysqlPoolSelectQuery(jsonData.query, function(rowsOrStatus, err) {
                        if (err) {
                            rollbackTransaction();
                            console.log( colors.red("dbWorker.error 3: "), err.code, colors.cyan(jsonData.query));
                            channel.ack(message);
                            // 2 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {
                            // здесь 1 - отправка подтверждения,
                            channel.ack(message);

                            delete jsonData["socketId"];
                            delete jsonData["query"];
                            delete jsonData["action"];

                            //2. обновляем кэш
                            var jsonUserObj = JSON.stringify(jsonData);
                            redisClient.hget("users", jsonData.token, function(err, reply) {

                                if(err || !reply) {
                                    //
                                } else {
                                    var userJsonData = JSON.parse(reply);
                                    //записываем в кэш по ключу "телефон" данные о юзере (обновляем их)
                                    redisClient.hset("users", userJsonData.phone, jsonUserObj);
                                }
                            });

                            commitTransaction();

                            // 3 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "ok");
                        }
                    });
                    break;
                }

                case "updateGoods": {

                    jDataAck.action = "updateGoods";

                    mysqlPoolQuery(jsonData.query, function(rowsOrStatus, err) {
                        if (err) {
                            console.log( colors.red("dbWorker.error 3: "), err.code, colors.cyan(jsonData.query));
                            channel.ack(message);
                            // 2 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {
                            // здесь 1 - отправка подтверждения,
                            channel.ack(message);

                            //обновляем запись в кэше
                            redisClient.hget("users", jsonData.user_phone, function(err, reply) {
                                var userInfo = JSON.parse(reply);
                                try {
                                    userInfo.goods = JSON.parse(jsonData.goods);
                                } catch(ex) {
                                    console.log("updateGoods.json.parse.error:", ex);
                                }


                                var jsonUserStr = JSON.stringify(userInfo);
                                redisClient.hset("users", jsonData.user_phone, jsonUserStr);
                            });
                            // 3 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "ok");
                        }
                    });
                    break;
                }

                case "deleteTransactionsHistory": {

                    jDataAck.action = "deleteTransactionsHistory";

                    //если не было передано ни одного id действия для удаления, то возвращаем ошибку
                    if(jsonData.actionsIds.length == 0) {
                        jDataAck.error = "expect_not_null_actionsIds_parameter";
                        sendAckToServer(jDataAck, "error");
                        return false;
                    }

                    startTransaction();

                    //из переданных id-транзакций, которые нужно удалять, проверяем и выбираем только те,
                    //которые относятся к текущему юзеру (чтобы один юзер не мог удалить записи у другого)
                    var q1 = "SELECT act.id FROM actions as act RIGHT JOIN assets as a ON " +
                        "act.asset_id=a.id " +
                        "WHERE act.id IN("+jsonData.actionsIds.toString()+") AND a.user_id="+jsonData.user_id;

                    mysqlPoolSelectQuery(q1, function(rowsOrStatus, err) {
                        if (err) {
                            rollbackTransaction("0");
                            console.log( colors.red("dbWorker.error 3: "), err.code, colors.cyan(q1));
                            channel.ack(message);
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {
                            channel.ack(message);

                            var rowsForDelete = [];
                            for(var row in rowsOrStatus) {
                                rowsForDelete.push(rowsOrStatus[row].id);
                            }

                            //если в списке не было ни одного id действия, принадлежащего данному юзеру
                            if(rowsForDelete.length == 0) {
                                rollbackTransaction("1");
                                jDataAck.error = "actionsIds_must_belong_current_user";
                                sendAckToServer(jDataAck, "error");
                                return false;
                            }

                            var q2 = "DELETE FROM actions WHERE id IN("+rowsForDelete.toString()+") " +
                                "AND status !='PENDING'";

                            mysqlPoolSelectQuery(q2, function (statusOrRows, errorInfo) {

                                if(statusOrRows.affectedRows > 0) {
                                    commitTransaction();
                                    sendAckToServer(jDataAck, "ok");
                                } else if(statusOrRows.affectedRows == 0 ) {
                                    rollbackTransaction("1.5");
                                    jDataAck.error = "actionsIds_not_found";//не найдено что удалять
                                    sendAckToServer(jDataAck, "error");
                                    return false;
                                } else if(statusOrRows =="error") {
                                    rollbackTransaction("2");
                                    jDataAck.error = errorInfo.code;
                                    sendAckToServer(jDataAck, "error");
                                    return false;
                                }

                            });
                        }
                    });
                    break;
                }

                case "deleteAccount": {

                    jDataAck.action = "deleteAccount";

                    startTransaction();
                    //алгоритм:
                    //1. получаем список активов и партнеров, принадлежащих данному юзеру
                    //2. удаляем все записи в истории действий данного юзера(кроме тех, у которых статус PENDING)
                    //3. удаляем все активы, принадлежащих данному юзеру
                    //4. делаем всех партнеров невидимыми и обнуляем сальдо(нужно ли обнулять сальдо?)
                    //5. очищаем все поля записи юзера, меняем токен на произвольный и никому не известный
                    //6. удаляем данные о юзере из редиса
                    //7. создаем записи "по умолчанию" для юзера
                    //8. удаляем аватарку юзера из S3(либо заменяем ее на иконку "юзер удален")(это на клиенте)

                    //1.
                    var q1 = "SELECT id FROM assets WHERE user_id="+jsonData.user_id;
                    mysqlPoolSelectQuery(q1, function(rowsOrStatus, err) {
                        if (err) {
                            rollbackTransaction("del.0");
                            console.log( colors.red("dbWorker.error 3: "), err.code, colors.cyan(q1));
                            channel.ack(message);
                            jDataAck.error = err.code;
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {
                            channel.ack(message);

                            var assetsRowsForDelete = [];
                            for(var row in rowsOrStatus) {
                                assetsRowsForDelete.push(rowsOrStatus[row].id);
                            }

                            //если в списке не было ни одного id действия, принадлежащего данному юзеру
                            if(assetsRowsForDelete.length == 0) {
                                //если не было найдено ни одного актива (сперва юзер сам удалил активы, а затем
                                //решил удалить аккаунт)

                                var newToken = sha1(Math.random());
                                var q_5 = "UPDATE users SET name='', address='', business='', " +
                                    "position='', requisites='', city='', company='', " +
                                    "goods='', token='"+newToken+"', pushToken='' WHERE id="+jsonData.user_id;
                                mysqlPoolQuery(q_5, function (status5, err5) {
                                    console.log("final.del(2).: ", status5, err5);
                                    if(err5) {
                                        rollbackTransaction("del.5"+err5.code);
                                        jDataAck.error = err5.code;
                                        sendAckToServer(jDataAck, "error");
                                        return false;
                                    } else if(status5 == "ok") {

                                        //7. создаем записи "по умолчанию" для юзера
                                        var q7 = "INSERT INTO assets(user_id, name, type, is_cost, is_visible, " +
                                            "was_declined) " +
                                            "VALUES("+jsonData.user_id+", 'Банковская карта','asset', 0, 1, 0), " +
                                            "("+jsonData.user_id+", 'Кошелек','asset', 0, 1, 0), " +
                                            "("+jsonData.user_id+", 'Сбережения','asset', 0, 1, 0), " +
                                            "("+jsonData.user_id+", 'Склад','asset', 0, 1, 0), " +
                                            "("+jsonData.user_id+", 'Развлечения','asset', 1, 1, 0), " +
                                            "("+jsonData.user_id+", 'Дорога','asset', 1, 1, 0), " +
                                            "("+jsonData.user_id+", 'Семья','asset', 1, 1, 0), "+
                                            "("+jsonData.user_id+", 'temporary_asset','asset', 1, 0, 1)";

                                        mysqlPoolQuery(q7, function (status7, err7) {
                                            if(err7) {
                                                rollbackTransaction("del.7"+err7.code);
                                                jDataAck.error = err7.code;
                                                sendAckToServer(jDataAck, "error");
                                                return false;
                                            } else if(status7 == "ok") {
                                                commitTransaction();
                                                // шаг 6 - удаляем данные о юзере из редиса
                                                redisClient.hdel("id2phone", jsonData.user_id,
                                                    function (er, repl) {});

                                                redisClient.hdel("id2phone", jsonData.user_id,
                                                    function (er, repl) {});



                                                redisClient.hget("users", jsonData.user_token,
                                                    function (err, rplToken) {
                                                        console.log("rplToken", rplToken,
                                                            jsonData.user_token);
                                                        var userInfoData = JSON.parse(rplToken);
                                                        userInfoData.token = newToken;
                                                        var userInfoDataString =
                                                            JSON.stringify(userInfoData);
                                                        redisClient.hset("users", newToken,
                                                            userInfoDataString);

                                                        redisClient.hdel("users", jsonData.user_token,
                                                            function (er, repl) {});

                                                    });

                                                redisClient.hget("users", jsonData.user_phone,
                                                    function (err, rplToken) {
                                                        console.log("rplToken2", rplToken,
                                                            jsonData.user_phone);
                                                        var userInfoData = JSON.parse(rplToken);
                                                        userInfoData.token = newToken;
                                                        var userInfoDataString =
                                                            JSON.stringify(userInfoData);
                                                        redisClient.hset("users", jsonData.user_phone,
                                                            userInfoDataString);
                                                    });

                                                //
                                                // redisClient.hdel("users", jsonData.user_phone,
                                                //     function (er, repl) {});

                                                var regChatMsg = {};
                                                regChatMsg.action = "changePassword";
                                                regChatMsg.login = jsonData.user_phone;
                                                regChatMsg.password = newToken;
                                                sendToChatQueue(regChatMsg);

                                                sendAckToServer(jDataAck, "ok");
                                            }
                                        });
                                    }

                                });

                            } else {
                                //если были найдены активы в аккаунте пользователя
                                //2.
                                var q2 = "DELETE FROM actions WHERE asset_id IN("+assetsRowsForDelete.toString()+") " +
                                    " AND status !='PENDING'";
                                mysqlPoolQuery(q2, function(status2, err2) {
                                   if(err2) {
                                       rollbackTransaction("del.2");
                                       jDataAck.error = err2.code;
                                       sendAckToServer(jDataAck, "error");
                                       return false;
                                   } else {
                                       //3.
                                       var q3 = "DELETE FROM assets WHERE type='asset' " +
                                           "AND id IN("+assetsRowsForDelete.toString()+") " +
                                           "AND user_id="+jsonData.user_id;
                                       mysqlPoolQuery(q3, function (status3, err3) {
                                           if(err3) {
                                               rollbackTransaction("del.3");
                                               jDataAck.error = err3.code;
                                               sendAckToServer(jDataAck, "error");
                                               return false;
                                           } else if(status3 == "ok") {
                                               //4.делаем невидимыми партнеров юзера и обнуляем их сальдо
                                               //TODO: узнать, требуется ли обнулять здесь сальдо
                                               var q4 = "UPDATE assets SET is_visible=0, saldo=0 WHERE " +
                                                   "type='partner' AND user_id="+jsonData.user_id;
                                               mysqlPoolQuery(q4, function (status4, err4) {

                                                   if(err3) {
                                                       rollbackTransaction("del.4");
                                                       jDataAck.error = err4.code;
                                                       sendAckToServer(jDataAck, "error");
                                                       return false;
                                                   } else if(status4 == "ok") {
                                                       //5.
                                                       var newToken = sha1(Math.random());
                                                       var q5 = "UPDATE users SET name='', address='', business='', " +
                                                           "position='', requisites='', city='', company=''," +
                                                           " goods='', token='"+newToken+"', " +
                                                           "pushToken='' WHERE id="+jsonData.user_id;
                                                       mysqlPoolQuery(q5, function (status5, err5) {
                                                           console.log("final.del.: ", status5, err5);
                                                           if(err5) {
                                                               rollbackTransaction("del.5"+err5.code);
                                                               jDataAck.error = err5.code;
                                                               sendAckToServer(jDataAck, "error");
                                                               return false;
                                                           } else if(status5 == "ok") {

                                                               //7. создаем записи "по умолчанию" для юзера
                                                               var q7 = "INSERT INTO assets(user_id, name, type, " +
                                                                   "is_cost, is_visible, was_declined) " +
                                                                   "VALUES("+jsonData.user_id+", 'Банковская карта'," +
                                                                   "'asset', 0, 1, 0), " +
                                                                   "("+jsonData.user_id+", 'Кошелек'," +
                                                                   "'asset', 0, 1, 0), " +
                                                                   "("+jsonData.user_id+", 'Сбережения'," +
                                                                   "'asset', 0, 1, 0), " +
                                                                   "("+jsonData.user_id+", 'Склад'," +
                                                                   "'asset', 0, 1, 0), " +
                                                                   "("+jsonData.user_id+", 'Развлечения'," +
                                                                   "'asset', 1, 1, 0), " +
                                                                   "("+jsonData.user_id+", 'Дорога'," +
                                                                   "'asset', 1, 1, 0), " +
                                                                   "("+jsonData.user_id+", 'Семья'," +
                                                                   "'asset', 1, 1, 0), "+
                                                                   "("+jsonData.user_id+", 'temporary_asset'," +
                                                                   "'asset', 1, 0, 1)";

                                                               mysqlPoolQuery(q7, function (status7, err7) {
                                                                   if(err7) {
                                                                       rollbackTransaction("del.7"+err7.code);
                                                                       jDataAck.error = err7.code;
                                                                       sendAckToServer(jDataAck, "error");
                                                                       return false;
                                                                   } else if(status7 == "ok") {
                                                                       commitTransaction();
                                                                       // шаг 6 - удаляем данные о юзере из редиса
                                                                       redisClient.hdel("id2phone", jsonData.user_id,
                                                                           function (er, repl) {});

                                                                       redisClient.hdel("id2phone", jsonData.user_id,
                                                                           function (er, repl) {});



                                                                       redisClient.hget("users", jsonData.user_token,
                                                                           function (err, user_token) {
                                                                               console.log("rplToken", user_token,
                                                                                   jsonData.user_phone);
                                                                               var userInfoData =
                                                                                   JSON.parse(user_token);

                                                                               //bug fix
                                                                               if(userInfoData == null) {
                                                                                   userInfoData = {};
                                                                               }

                                                                               userInfoData.token = newToken;
                                                                               var userInfoDataString =
                                                                                   JSON.stringify(userInfoData);
                                                                               redisClient.hset("users",
                                                                                   newToken,
                                                                                   userInfoDataString);

                                                                               redisClient.hdel("users",
                                                                                   jsonData.user_token,
                                                                                   function (er, repl) {});

                                                                           });

                                                                       redisClient.hget("users", jsonData.user_phone,
                                                                           function (err, rplToken) {
                                                                               console.log("rplToken2", rplToken,
                                                                                   jsonData.user_phone);
                                                                               var userInfoData = JSON.parse(rplToken);

                                                                               //bug fix
                                                                               if(userInfoData == null) {
                                                                                   userInfoData = {};
                                                                               }

                                                                               userInfoData.token = newToken;
                                                                               var userInfoDataString =
                                                                                   JSON.stringify(userInfoData);
                                                                               redisClient.hset("users",
                                                                                   jsonData.user_phone,
                                                                                   userInfoDataString);
                                                                           });

                                                                       //
                                                                       // redisClient.hdel("users", jsonData.user_phone,
                                                                       //     function (er, repl) {});

                                                                       var regChatMsg = {};
                                                                       regChatMsg.action = "changePassword";
                                                                       regChatMsg.login = jsonData.user_phone;
                                                                       regChatMsg.password = newToken;
                                                                       sendToChatQueue(regChatMsg);

                                                                       sendAckToServer(jDataAck, "ok");
                                                                   }
                                                               });


                                                               // шаг 6 - удаляем данные о юзере из редиса
                                                               redisClient.hdel("id2phone", jsonData.user_id,
                                                                   function (er, repl) {});

                                                               redisClient.hdel("id2phone", jsonData.user_id,
                                                                   function (er, repl) {});


                                                               redisClient.hget("users", jsonData.user_token,
                                                               function (err, user_token) {
                                                                   console.log("rplToken", user_token,
                                                                       jsonData.user_phone);
                                                                   var userInfoData = JSON.parse(user_token);

                                                                   //bug fix
                                                                   if(userInfoData == null) {
                                                                       userInfoData = {};
                                                                   }

                                                                   userInfoData.token = newToken;
                                                                   var userInfoDataString =
                                                                       JSON.stringify(userInfoData);
                                                                   redisClient.hset("users", newToken,
                                                                       userInfoDataString);

                                                                   redisClient.hdel("users", jsonData.user_token,
                                                                       function (er, repl) {});
                                                               });

                                                               redisClient.hget("users", jsonData.user_phone,
                                                                   function (err, rplToken) {
                                                                       console.log("rplToken2", rplToken,
                                                                           jsonData.user_phone);
                                                                       var userInfoData = JSON.parse(rplToken);

                                                                       //bug fix
                                                                       if(userInfoData == null) {
                                                                           userInfoData = {};
                                                                       }

                                                                       userInfoData.token = newToken;
                                                                       var userInfoDataString =
                                                                           JSON.stringify(userInfoData);
                                                                       redisClient.hset("users", jsonData.user_phone,
                                                                           userInfoDataString);
                                                               });


                                                               // redisClient.hdel("users", jsonData.user_token,
                                                               //     function (er, repl) {});

                                                               // redisClient.hdel("users", jsonData.user_phone,
                                                               //     function (er, repl) {});

                                                               var regChatMsg = {};
                                                               regChatMsg.action = "deleteUser";
                                                               regChatMsg.login = jsonData.user_phone;
                                                               regChatMsg.password = newToken;
                                                               sendToChatQueue(regChatMsg);

                                                               commitTransaction();

                                                               // sendAckToServer(jDataAck, "ok");
                                                           }
                                                       });
                                                   }
                                               });
                                           }
                                       });
                                   }
                                });
                            }
                        }
                    });
                    break;
                }

                case "setPushToken": {


                    jDataAck.action = jsonData.action;

                    startTransaction();
                    mysqlPoolSelectQuery(jsonData.query, function(rowsOrStatus, err) {
                        if (err) {
                            rollbackTransaction();
                            console.log( colors.red("dbWorker.error 3: "), err.code, colors.cyan(jsonData.query));
                            channel.ack(message);
                            // 2 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {

                            var q2 = 'SELECT users.pushToken as pushToken, assets.id as id FROM users ' +
                                'LEFT JOIN assets ON users.phone=assets.partner_phone ' +
                                'WHERE assets.type="partner" AND users.phone='+jsonData.phone;


                            mysqlPoolSelectQuery(q2, function (rowsOrStatus) {

                                if(rowsOrStatus == "error" || rowsOrStatus.length == 0) {
                                    channel.ack(message);
                                    rollbackTransaction();
                                    sendAckToServer(jDataAck, "error");
                                    return false;
                                }

                                //TODO: устарело, можно удалить.
                                //актуальный вызов - через mysql-запрос
                                for (var i = 0; i < rowsOrStatus.length; i++) {
                                    var partnerId = rowsOrStatus[i].id;
                                    var pushToken = rowsOrStatus[i].pushToken;
                                    redisClient.hset("partnerId2pushToken", partnerId, pushToken);
                                }

                                commitTransaction();
                                // здесь 1 - отправка подтверждения,
                                channel.ack(message);
                                // 2 - отправка сообщения в др. очередь
                                // сообщение о том, с каким результатом была выполнена операция(ok или error)
                                sendAckToServer(jDataAck, "ok");

                            });
                        }
                    });

                    break;
                }

                default: {
                    console.log( colors.green("default case") );
                    jDataAck.action = jsonData.action;

                    startTransaction();
                    mysqlPoolSelectQuery(jsonData.query, function(rowsOrStatus, err) {
                        if (err) {
                            rollbackTransaction();
                            console.log( colors.red("dbWorker.error 3: "), err.code, colors.cyan(jsonData.query));
                            channel.ack(message);
                            // 2 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "error");
                            return false;
                        } else {
                            commitTransaction();
                            // здесь 1 - отправка подтверждения,
                            channel.ack(message);
                            // 2 - отправка сообщения в др. очередь
                            // сообщение о том, с каким результатом была выполнена операция(ok или error)
                            sendAckToServer(jDataAck, "ok");
                        }
                    });
                    break;
                }
            }

        });
    });

    return ok;
}).then(null, console.log);


//worker for multi-steps operations (transfers)
rabbit2.then(function(connection) {
    var ok = connection.createChannel();

    ok.then(function(channel) {
        // durable: true is set by default
        channel.assertQueue("messagesTransfer");
        channel.assertExchange("incomingTransfer");
        channel.bindQueue("messagesTransfer", "incomingTransfer", "mda");
        /**
         * Обработка операций по переводам между активами
         */
        channel.consume("messagesTransfer", function(message) {
            if(message == null && message == undefined) {
                console.log("worker.messagesTransfer.error");
                return false;
            }
            var jsonDataString = message.content.toString();
            var jsonData = JSON.parse(jsonDataString);

            //for acks
            var jDataAck = {};
            jDataAck.socketId = jsonData.socketId;
            jDataAck.requestId = jsonData.requestId;

            /******************SALDO ZONE****************************/
            switch(jsonData.action) {
                case "setSaldo": {
                    console.log("dbWorker.case.setSaldo");
                    startTransaction();
                    setSaldo(jsonData, function (status) {
                        channel.ack(message);
                        console.log("setSaldo.response", status);

                        if(status == "ok") {
                            commitTransaction();
                            console.log("dbWorker.case.setSaldo.ok");
                        } else if(status == "error") {
                            jsonData.error = status.errorInfo;
                            rollbackTransaction();
                            console.log("dbWorker.case.setSaldo.error");
                        }
                        sendTransferAckToServer(jsonData, status);
                    });
                    return false;
                }

                case "acceptNewSaldo": {
                    console.log("dbWorker.case.acceptNewSaldo");
                    startTransaction();
                    acceptNewSaldo(jsonData, function (status) {
                        channel.ack(message);

                        if(status == "ok") {
                            commitTransaction();
                            updateBadges();
                        } else if(status == "error") {
                            rollbackTransaction();
                        }

                        sendTransferAckToServer(jsonData, status);
                    });

                    return false;
                }

                case "declineNewSaldo": {
                    console.log("dbWorker.case.declineNewSaldo");
                    startTransaction();
                    declineNewSaldo(jsonData, function (status) {
                        channel.ack(message);

                        if(status == "ok") {
                            commitTransaction();
                            updateBadges();
                        } else if(status == "error") {
                            rollbackTransaction();
                        }

                        sendTransferAckToServer(jsonData, status);
                    });
                    return false;
                }
            }
            /***************END SALDO ZONE***************************/

            /**************TEMPORARY ASSET ZONE**********************/
            switch(jsonData.action) {
                case "transferFromTemporaryAsset2Asset": {

                    startTransaction();
                    transferFromTemporaryAsset2Asset(jsonData,
                        function (result, error_info) {
                            channel.ack(message);
                            if(error_info) {
                                jsonData.error = error_info;
                            }

                            if(result == "ok") {
                                commitTransaction();
                                updateBadges();
                            } else if(result == "error") {
                                rollbackTransaction();
                            }

                            sendTransferAckToServer(jsonData, result);
                            return false;
                        });
                    return false;
                }
                case "deleteFromTemporaryAsset": {

                    startTransaction();
                    deleteFromTemporaryAsset(jsonData,
                        function (result, error_info) {
                            channel.ack(message);
                            if(error_info) {
                                jsonData.error = error_info;
                            }

                            if(result == "ok") {
                                commitTransaction();
                                updateBadges();
                            } else if(result == "error") {
                                rollbackTransaction();
                            }
                            sendTransferAckToServer(jsonData, result);
                            return false;
                        });
                    return false;
                }
            }

            /*************END TEMPORARY ASSET ZONE*******************/

            /*
             алгоритм работы выполнения переводов:
             1. проверяем типы from и to активов
             1.1. если оба актива существуют для данного юзера - идем дальше. если нет - выдаем ошибку.
             2.1. если оба актива имеют тип "актив" - переводим средства с одного на другой,
                  обновляем сальдо обоих активов.
                  Аналогично - если один или оба актива имеют тип "категория расходов"
             * создаем 2 записи действий - по записи для каждого из активов. запись "списано" и "пополнено"
             *
             3. если один из активов имеет тип "партнер", то:
             * определяем - мы переводим от себя или запрашиваем перевод к себе
             * если от себя к другому, то атамарно:
                 * ставим новое сальдо на активе "откуда",
                 * создаем 3 записи истории действий "перевод в процессе. from->to":
                     * одну запись для актива "откуда" данного юзера(отправителя)
                     * вторую запись для актива "куда" для данного юзера(актив-получатель)
                     * третью запись для актива-партнера у юзера-получателя
                 * обновляем состояние unconfirmed_deals у:
                     *   юзера-отправителя (актив "откуда")
                     *   юзера-получателя (актив "партнер")
                 * шлем пуш-уведомление партнеру-получателю
                 * ожидаем подтверждения от другого юзера(партнера)
             * если получено подтверждение перевода, то:
                * создаем 4-ую запись в истории действий:
                    * у юзера-получателя для актива-приемника ("получено")
                * ставим новое сальдо у юзера-получателя, на активе-приемнике и на активе-партнере
                * обновляем статусы у всех 4-х действий (из "в ожидании" на "переведено")
                * обновляем состояние unconfirmed_deals у:
                     * юзера-отправителя (появился новый бейдж, т.к. появилось новое состояние)
                     * юзера-получателя (аналогично)
                * (возможно) шлем пуш-уведомление партнеру-отправителю
             * если перевод отклонен, то:
                * обновляем 2 сальдо обратно, у юзера-отправителя (актив "откуда" и "куда" )
                * обновляем статусы у всех 4-х действий в истории(из "в ожидании" на "отклонено")
                * обновляем состояние unconfirmed_deals у:
                     * юзера-отправителя (появился новый бейдж, т.к. появилось новое состояние)
                     * юзера-получателя (аналогично)
                * (возможно) шлем пуш-уведомление партнеру-отправителю
             4. если оба имеют тип "партнер", то выполняем перевод партнер->партнер
             */

            ///////////////////вставка для ACCEPT & DECLINE///////////////////
            if(jsonData.action == "declineTransfer") {
                startTransaction();
                declineTransfer(jsonData, function (status, error_info) {
                    channel.ack(message);
                    jsonData.error = error_info;

                    if(status == "ok") {
                        commitTransaction();
                        updateBadges();
                    } else if(status == "error") {
                        rollbackTransaction();
                    }

                    sendTransferAckToServer(jsonData, status);
                });
                return false;
            } else if(jsonData.action == "acceptTransfer") {
                startTransaction();
                acceptTransfer(jsonData, function (status, error_info) {
                    channel.ack(message);
                    jsonData.error = error_info;
                    if(status == "ok") {
                        commitTransaction();
                        updateBadges();
                    } else if(status == "error") {
                        rollbackTransaction();
                    }

                    sendTransferAckToServer(jsonData, status);
                });
                return false;
            }

            //////////////конец вставки для ACCEPT & DECLINE//////////////////


            /*реализация транзакций*/
            // 1. проверяем типы from и to активов
            var q1 = "SELECT id, name, asset_id_in_partner, user_id, type, saldo, partner_phone FROM assets " +
                "WHERE user_id="+jsonData.user_id
                +" AND id="+jsonData.from+" OR id="+jsonData.to+" LIMIT 2";
            startTransaction();
            mysqlPoolSelectQuery(q1, function (rows, error_info1) {

                if(error_info1) {
                    console.log( colors.red( "dbWorkerTransfer.error: "), error_info1, "stack:", q1);
                    rollbackTransaction();
                    channel.ack(message);
                    jsonData.error = error_info1;
                    sendTransferAckToServer(jsonData, "error");
                    return false;
                } else if(rows.length == 0) {
                    rollbackTransaction();
                    channel.ack(message);
                    jsonData.error = "not_valid_action";
                    sendTransferAckToServer(jsonData, "error");
                    return false;
                } else {
                    //обрабатываем ситуацию ошибки, когда в базе данных нет найдено 2 актива(from и to)
                    if(rows.length != 2) {
                        console.log( colors.red("error: number of assets NOT equals 2") );
                        rollbackTransaction();
                        channel.ack(message);
                        sendTransferAckToServer(jsonData, "error");
                        return false;
                    }

                    var toAsset = rows[0].id == jsonData.to ? rows[0] : rows[1];
                    var fromAsset = rows[0].id == jsonData.from ? rows[0] : rows[1];

                    // 2.1. если оба актива имеют тип "актив" - переводим средства с одного на другой,
                    // обновляем сальдо обоих активов.
                    if( fromAsset.type == "asset" && toAsset.type == "asset" ) {
                        if(fromAsset.name == "temporary_asset") {
                            rollbackTransaction();
                            channel.ack(message);
                            jsonData.error = "use_special_methods_for_temporary_asset";
                            sendTransferAckToServer(jsonData, "error");
                        } else {
                            transferAsset2Asset(fromAsset, toAsset, jsonData.user_id, jsonData.amount,
                                jsonData.outgoingFromAsset, jsonData.comment1, jsonData.comment2,
                                function (result, error_info) {
                                    channel.ack(message);
                                    if(result == "ok") {
                                        commitTransaction();
                                        updateBadges();
                                    } else if(result == "error") {
                                        rollbackTransaction();
                                    }
                                    jsonData.error = error_info;
                                    sendTransferAckToServer(jsonData, result);
                                });
                        }

                        // 3. если один из активов имеет тип "партнер", то:
                        // * определяем - мы переводим от себя или запрашиваем перевод к себе
                        // юзер переводит средства со своего актива на актив типа "партнер"
                    } else if( fromAsset.type == "asset" && toAsset.type == "partner" ) {
                        transferAsset2Partner(fromAsset, toAsset, jsonData.user_id, jsonData.amount,
                            jsonData.outgoingFromAsset, jsonData.myPhone, jsonData.comment1, jsonData.comment2,
                            function (result, error_info) {
                                channel.ack(message);
                                if(error_info) {
                                    jsonData.error = error_info;
                                }
                                if(result == "ok") {
                                    commitTransaction();
                                    updateBadges();
                                } else if(result == "error") {
                                    rollbackTransaction();
                                }
                                sendTransferAckToServer(jsonData, result);
                            });
                    } else if(fromAsset.type == "partner" && toAsset.type == "asset") {
                        transferPartner2Asset(fromAsset, toAsset, jsonData.user_id, jsonData.amount,
                            jsonData.outgoingFromAsset, jsonData.myPhone, jsonData.comment1, jsonData.comment2,
                            function (result, error_info) {

                                if(result == "ok") {
                                    commitTransaction();
                                    updateBadges();
                                } else if(result == "error") {
                                    rollbackTransaction();
                                }

                                channel.ack(message);
                                jsonData.error = error_info;
                                sendTransferAckToServer(jsonData, result);
                            });
                    } else if(fromAsset.type == "partner" && toAsset.type == "partner") {

                        transferPartner2Partner(fromAsset, toAsset, jsonData.user_id, jsonData.amount,
                            jsonData.outgoingFromAsset, jsonData.myPhone, jsonData.comment1, jsonData.comment2,
                            function (result, error_info) {

                                if(result == "ok") {
                                    commitTransaction();
                                    updateBadges();
                                } else if(result == "error") {
                                    rollbackTransaction();
                                }

                                channel.ack(message);
                                jsonData.error = error_info;
                                sendTransferAckToServer(jsonData, result);
                            });
                    } else {
                        rollbackTransaction();
                        sendTransferAckToServer(jsonData, "error");
                    }
                }
            });

        });
    });

    return ok;
}).then(null, console.log);

/********************TRANSFER FUNCTIONS*******************/

/********************SMS and PUSH*************************/
rabbit5.then(function(connection) {
    var ok = connection.createChannel();

    ok.then(function(channel) {

        channel.assertQueue("sms");//messages
        channel.assertExchange("sms_exchange");//incoming
        channel.bindQueue("sms", "sms_exchange", "mda");

        /**
         * Обработка операций по отправкам смс
         */
        channel.consume("sms", function(message) {

            var jsonDataString = message.content.toString();
            var jsonData = JSON.parse(jsonDataString);

            channel.ack(message);

            switch(jsonData.msgType) {
                case "sms": {
                    //INFO: эту часть кода можно выделить в отдельный воркер (т.е. разделить по отдельным
                    //воркерам службы отправки сообщений и уведомлений

                    //ok.worked
                    //INFO: http://smsc.ru/api/http/#send
                    //TODO: раскомментировать для возврата отправки смс
                    request.post({url:process.env.SMSC_HOST_URL, form: {
                            login:process.env.SMSC_LOGIN,
                            psw:process.env.SMSC_PASS,
                            phones:jsonData.phone,
                            mes: "Partner sms code: "+jsonData.sms_code,
                            sender: "Partner"
                        }},
                        function(err,httpResponse,body){
                            console.log( colors.green("smsc response info:"),body );
                            // TODO: добавить сюда отправку подтверждения
                            sendTransferAckToServer(jsonData, "ok");
                            // sendTransferAckToServer(jsonData, "error");
                        });
                    break;
                }

                case "push": {
                    getIconBagesByUserId(jsonData.assetId, function(bagesNum) {

                        console.info("send.push", jsonData);
                        console.info("bagesNum=", bagesNum);

                        note.expiry = Math.floor(Date.now() / 1000) + 3600;
                        note.badge = bagesNum;
                        note.alert = jsonData.message || "new Partner message";
                        // note.payload = {assetId:5};
                        var assetId = jsonData.assetId || -1;
                        var pushToken = jsonData.pushToken || -1;

                        if(!pushToken || pushToken == null || pushToken == 'null' ||
                            !assetId || assetId == -1 || pushToken == -1) {
                            console.log("error: push not found", pushToken);
                            //break;
                        }
                        else {
                            note.payload = {assetId:assetId};
                            note.sound = "default";

                            var myDevice = new apn.Device(pushToken);
                            apnConn.pushNotification(note, myDevice);
                        }
                    });
                    break;
                }

                default: {
                    console.log( colors.red("sms type is undefined") );
                }
            }

        });
    });

    return ok;
});//.then(null, console.log);
/********************END SMS and PUSH*********************/


/**
 * Перевод с партнера на партнера
 * @param fromPartner
 * @param toPartner
 * @param userId
 * @param amount
 * @param outgoingFromPartner
 * @param myPhone
 * @param comment1
 * @param comment2
 * @param cb
 */
function transferPartner2Partner(fromPartner, toPartner, userId, amount, outgoingFromPartner, myPhone,
                               comment1, comment2, cb) {
    /*INFO:
    user1 - тот, кто инициировал перевод партнер->партнер
    user2 - тот, от кого перечисляются деньги
    user3 - тот, кому перечисляются деньги
     */

    //проверка входящих параметров
    if(fromPartner.id <=0) {
        cb("error", "wrong_from_parameter");
        return false;
    } else if(toPartner.id <=0) {
        cb("error", "wrong_to_parameter");
        return false;
    }

    if(comment2 =="" || comment2 == undefined) comment2 = comment1;

    //получаем id двух партнеров, между которыми делаем перевод
    // var q0 = "SELECT asset_id_in_partner FROM assets " +
    //     "WHERE unconfirmed_incoming_deals=0 AND id IN("+fromPartner.id+", "+toPartner.id+")";

    //проверяем, нет ли у юзеров-получателей перевода не обработанных исходящих сделок
    var q0 = "SELECT unconfirmed_outgoing_deals FROM assets WHERE id IN("+
        fromPartner.asset_id_in_partner+", "+toPartner.asset_id_in_partner+") " +
        "AND unconfirmed_outgoing_deals>0";


    mysqlPoolSelectQuery(q0, function(rowsOrStatus, err0){

        //проверяем, можем ли юзер делать перевод
        // (нет ли у него входящих не закрытых переводов от каждого из партнера)
        // if(rows0.length < 2) {
        //     //если есть не завершенные входящие сделки
        //     cb("error", "processing_erly_actions_before");//Обработайте сперва более ранние транзакции
        //     return false;
        // }

        if(rowsOrStatus == "error") {
            console.error("error.transferPartner2Partner", err0, q0);
            cb("error",err0.code);
            return false;
        }

        if(rowsOrStatus.length > 0) {
            console.error("error.transferPartner2Partner.processing_incoming_before");
            cb("error", "processing_incoming_before");
            return false;
        }

        // * ставим новое сальдо на партнера "откуда",
        //а так же ставим новое сальдо на активе, в который хотим получить перевод
        var fromPartnerNewSaldo = fromPartner.saldo - outgoingFromPartner;
        var toAssetNewSaldo = toPartner.saldo + amount;

        var q1 = "UPDATE assets SET saldo=CASE " +
            "WHEN id=" + fromPartner.id + " THEN " + fromPartnerNewSaldo +
            " WHEN id=" + toPartner.id + " THEN " + toAssetNewSaldo +
            " ELSE saldo END, " +

            "unconfirmed_outgoing_deals=CASE "+
            "WHEN id=" + fromPartner.id + " THEN unconfirmed_outgoing_deals+1 " +
            "WHEN id=" + toPartner.id + " THEN unconfirmed_outgoing_deals+1 " +
            " ELSE unconfirmed_outgoing_deals END, " +

            "unconfirmed_incoming_deals=CASE "+
            //отправляем бейджи user2 и user3
            "WHEN id=" + fromPartner.asset_id_in_partner + " THEN unconfirmed_incoming_deals+1 " +
            "WHEN id=" + toPartner.asset_id_in_partner + " THEN unconfirmed_incoming_deals+1 " +

            " ELSE unconfirmed_incoming_deals END, " +
            "is_visible=CASE " +
            "WHEN id=" + fromPartner.asset_id_in_partner + " THEN 1 " +
            "WHEN id=" + toPartner.asset_id_in_partner + " THEN 1 " +
            "ELSE is_visible END " +
            "WHERE id IN (" + fromPartner.id + ", "+toPartner.id+", "+
            fromPartner.asset_id_in_partner+", "+toPartner.asset_id_in_partner+")";

        mysqlPoolQuery(q1, function (mysqlResult) {

            //создаем 3 записи...
            // console.log("mysqlResult", mysqlResult, q1);
            var hash1 = sha1(new Date().getTime());
            var hash2 = sha1(Math.random());
            // * создаем 3 записи истории действий "перевод в процессе. from->to":
            var q2 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, status, from_id, to_id, " +
                "payment_sum, hash, comment) " +
                // * одну запись для партнера "откуда" данного юзера(отправителя). актив типа "партнер"
                "VALUES("+userId+", " +fromPartner.id + ", 'SEND_OUTGOING_PAYMENT_REQUEST', 'partner', 'PENDING', " +
                fromPartner.id + ", " + toPartner.id + ", " + outgoingFromPartner + ",'"+hash1+"','"+comment1+"'), " +
                // * вторую запись для актива "куда" для данного юзера(актив-получатель). актив типа "актив"
                "("+userId+", " + toPartner.id + ", 'SEND_INCOMING_PAYMENT_REQUEST', 'partner', " +
                "'PENDING', " + fromPartner.id + ", " + toPartner.id + ", " + amount + ",'"+hash2+"','"+comment2+"'), "+
                //тут закончилась отправка записей для user1
                //и далее - отправка запсей для user2 и user3
                // * третью запись для актива-партнера(отправителя средств)
                "("+userId+", "+fromPartner.asset_id_in_partner + ", 'GET_OUTGOING_PAYMENT_REQUEST', 'partner', " +
                "'PENDING', -1, "+fromPartner.asset_id_in_partner+", " + outgoingFromPartner + ",'"+ hash1+"', '"+
                comment1+"'), "+
                // * четвертую запись для актива-партнера(получателя средств)
                "("+userId+", "+toPartner.asset_id_in_partner + ", 'GET_INCOMING_PAYMENT_REQUEST', 'partner', " +
                "'PENDING', "+toPartner.asset_id_in_partner+", -1, " + amount + ",'"+ hash2+"', '"+comment2+"')";


            mysqlPoolQuery(q2, function (result) {
                //отправка push-уведомлений
                //1-му партнеру

                partnerId2pushToken(fromPartner.asset_id_in_partner, function (replyPushToken) {
                    if (replyPushToken == 0) {
                        //ошибка
                        console.error("mysql.partnerId2pushToken", fromPartner.id, replyPushToken);
                    } else {
                        //все ок
                        var jData = {};
                        jData.pushToken = replyPushToken;
                        jData.msgType = "push";
                        jData.message = "Новое предложение сделки";

                        //отправка уведомления 1-му партнеру
                        isOnline(fromPartner.asset_id_in_partner, function (onlineResult) {
                            jData.assetId = fromPartner.asset_id_in_partner;
                            if (onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                console.log("call sendSmsTaskToQueue 1", fromPartner.id, replyPushToken);
                                sendSmsTaskToQueue(jData);
                            }
                        });
                    }
                });


                //2-му
                partnerId2pushToken(toPartner.asset_id_in_partner, function (replyPushToken2) {
                    if(replyPushToken2 == 0) {
                        //ошибка
                        console.error("mysql.partnerId2pushToken", toPartner.id, replyPushToken2);
                    } else {
                        //все ок
                        var jData = {};
                        jData.pushToken = replyPushToken2;
                        jData.msgType = "push";
                        jData.message = "Новое предложение сделки";
                        //отправка уведомления 1-му партнеру
                        isOnline(toPartner.asset_id_in_partner, function (onlineResult) {
                            jData.assetId = toPartner.asset_id_in_partner;
                            if(onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                console.log("call sendSmsTaskToQueue 2", toPartner.id, replyPushToken2);
                                sendSmsTaskToQueue(jData);
                            }
                        });
                    }
                });



                cb(result);
            });
        });
    });
}

/**
 * Перевод с партнера на актив
 * @param fromPartner
 * @param toAsset
 * @param userId
 * @param amount
 * @param outgoingFromPartner
 * @param myPhone
 * @param comment1
 * @param comment2
 * @param cb
 */
function transferPartner2Asset(fromPartner, toAsset, userId, amount, outgoingFromPartner, myPhone,
                               comment1, comment2, cb) {

    //проверка входящих параметров
    if(fromPartner.id <=0) {
        cb("error", "wrong_from_parameter");
        return false;
    } else if(toAsset.id <=0) {
        cb("error", "wrong_to_parameter");
        return false;
    }

    //проверяем - нет ли не обработанных исходящих сделок у получателя данного перевода
    var q0 = "SELECT unconfirmed_outgoing_deals FROM assets WHERE id=" +
        fromPartner.asset_id_in_partner+" " +
        "AND unconfirmed_outgoing_deals>0";

    mysqlPoolSelectQuery(q0, function(statusOrRows, err0) {

        if(statusOrRows == "error") {
            console.error("transferPartner2Asset.error", err0.code);
            cb("error");
            return false;
        }

        if(statusOrRows.length > 0) {
            console.error("transferPartner2Asset.error.processing_incoming_before");
            cb("error", "processing_incoming_before");
            return false;
        }


        // * ставим новое сальдо на партнера "откуда",
        //а так же ставим новое сальдо на активе, в который хотим получить перевод
        var fromPartnerNewSaldo = fromPartner.saldo - outgoingFromPartner;
        var toAssetNewSaldo = toAsset.saldo + amount;
        var q1 = "UPDATE assets SET saldo=CASE " +
            "WHEN id=" + fromPartner.id + " THEN " + fromPartnerNewSaldo +
            " WHEN id=" + toAsset.id + " THEN " + toAssetNewSaldo +
            " ELSE saldo END, " +

            "unconfirmed_incoming_deals=CASE "+
            "WHEN id=" + fromPartner.asset_id_in_partner + " THEN unconfirmed_incoming_deals+1 " +
            " ELSE unconfirmed_incoming_deals END, " +

            "unconfirmed_outgoing_deals=CASE "+
            "WHEN id=" + fromPartner.id + " THEN unconfirmed_outgoing_deals+1 " +
            " ELSE unconfirmed_outgoing_deals END, " +

            "is_visible=CASE " +
            "WHEN id="+fromPartner.asset_id_in_partner+" THEN 1 " +
            "ELSE is_visible END " +
            "WHERE id IN (" + fromPartner.id + ", "+toAsset.id+", "+fromPartner.asset_id_in_partner+")";
        mysqlPoolQuery(q1, function (mysqlResult) {

            //создаем 3 записи...
            console.log("mysqlResult", mysqlResult);
            var hash = sha1(new Date().getTime());
            // * создаем 3 записи истории действий "перевод в процессе. from->to":
            var q2 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, status, from_id, to_id, " +
                "payment_sum, hash, comment) " +
                // * одну запись для партнера "откуда" данного юзера(отправителя). актив типа "партнер"
                // INFO: для актива-партнера списания записываем списанную сумму,
                // а для актива-получателя - получаемую сумму
                "VALUES("+userId+", " +fromPartner.id + ", 'SEND_OUTGOING_PAYMENT_REQUEST', 'partner', 'PENDING', " +
                fromPartner.id + ", " + toAsset.id + ", " + outgoingFromPartner + ",'"+hash+"','"+comment1+"'), " +

                // * вторую запись для актива "куда" для данного юзера(актив-получатель). актив типа "актив"
                "("+userId+", " + toAsset.id + ", 'GET_PAYMENT', 'asset', " +
                "'', " + fromPartner.id + ", " + toAsset.id + ", " + amount + ",'"+hash+"','"+comment2+"'), " +
                // * третью запись для актива-партнера у юзера-получателя
                "("+userId+", "+fromPartner.asset_id_in_partner + ", 'GET_OUTGOING_PAYMENT_REQUEST', 'partner', " +
                "'PENDING', -1, "+fromPartner.asset_id_in_partner+", " + outgoingFromPartner + ",'"+
                hash+"', '"+comment2+"')";

            mysqlPoolQuery(q2, function (result) {

                //отправка push-уведомлений пользователю-получателю
                partnerId2pushToken(fromPartner.asset_id_in_partner, function (replyPushToken) {
                    if(replyPushToken == 0) {
                        //ошибка
                        console.error("mysql.partnerId2pushToken", fromPartner.id, replyPushToken);
                    } else {
                        //все ок
                        var jData = {};
                        jData.pushToken = replyPushToken;
                        jData.assetId = fromPartner.asset_id_in_partner;//ok
                        jData.msgType = "push";
                        jData.message = "Новое предложение сделки";
                        isOnline(fromPartner.asset_id_in_partner, function (onlineResult) {
                            if(onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                sendSmsTaskToQueue(jData);
                            }
                        });
                    }
                });

                cb(result);
            });
        });

    });

}


function transferAsset2Partner(fromAsset, toPartner, userId, amount, outgoingFromAsset, myPhone,
     comment1, comment2, cb) {

    //проверка входящих параметров
    if(fromAsset.id <=0) {
        cb("error", "wrong_from_parameter");
        return false;
    } else if(toPartner.id <=0) {
        cb("error", "wrong_to_parameter");
        return false;
    }

    //проверяем - нет ли исходящих не обработанных сделок у партнера, которому мы пытаемся отправить свою
    //исходящую сделку
    var q0 = "SELECT unconfirmed_outgoing_deals FROM assets WHERE id=" +
        toPartner.asset_id_in_partner+" "+
        "AND unconfirmed_outgoing_deals>0";
    mysqlPoolSelectQuery(q0, function(statusOrRows, err0) {

        if(err0) {
            console.error("error.transferAsset2Partner", err0);
            cb("error", err0.code);
            return false;
        }

        if(statusOrRows == "error") {
            console.error("error.transferAsset2Partner", err0, statusOrRows, q0);
            cb("error");
            return false;
        }

        if(statusOrRows.length > 0) {
            console.error("error.transferAsset2Partner.processing_incoming_before");
            cb("error", "processing_incoming_before");
            return false;
        }

        // * ставим новое сальдо на активе "откуда",
        var fromAssetNewSaldo = fromAsset.saldo - outgoingFromAsset;
        var toPartnertNewSaldo = toPartner.saldo + amount;
        var q1 = "UPDATE assets SET saldo=CASE " +
            "WHEN id=" + fromAsset.id + " THEN " + fromAssetNewSaldo +
            " WHEN id=" + toPartner.id + " THEN " + toPartnertNewSaldo +
            " ELSE saldo END, " +

            "unconfirmed_outgoing_deals=CASE "+
            "WHEN id=" + toPartner.id + " THEN unconfirmed_outgoing_deals+1 " +
            " ELSE unconfirmed_outgoing_deals END, " +
            "unconfirmed_incoming_deals=CASE "+
            "WHEN id=" + toPartner.asset_id_in_partner + " THEN unconfirmed_incoming_deals+1 " +
            " ELSE unconfirmed_incoming_deals END, " +
            "is_visible=CASE " +
            "WHEN id="+toPartner.asset_id_in_partner+" THEN 1 " +
            "ELSE is_visible END "+
            "WHERE id IN (" + fromAsset.id + ", "+toPartner.id+", "+toPartner.asset_id_in_partner+")";
        mysqlPoolQuery(q1, function (mysqlResult) {

            //создаем 3 записи...
            var hash = sha1(new Date().getTime());
            // * создаем 3 записи истории действий "перевод в процессе. from->to":
            var q2 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, status, from_id, to_id, " +
                "payment_sum, hash, comment) " +
                // * одну запись для актива "откуда" данного юзера(отправителя). актив типа "актив"
                // INFO: для актива списания записываем списанную сумму, а для активов-партнеров - получаемую ими
                "VALUES("+userId+", " + fromAsset.id + ", 'SEND_PAYMENT', 'asset', '', " +
                fromAsset.id + ", " + toPartner.id + ", " + outgoingFromAsset + ",'"+hash+"','"+comment1+"'), " +
                // * вторую запись для актива "куда" для данного юзера(актив-получатель). актив типа "партнер"
                "("+userId+", " + toPartner.id + ", 'SEND_INCOMING_PAYMENT_REQUEST', 'partner', " +
                "'PENDING', " + fromAsset.id + ", " + toPartner.id + ", " + amount + ",'"+hash+"','"+comment2+"'), " +
                // * третью запись для актива-партнера у юзера-получателя
                "("+userId+", " + toPartner.asset_id_in_partner + ", 'GET_INCOMING_PAYMENT_REQUEST', 'partner', " +
                "'PENDING', " + toPartner.asset_id_in_partner + ", -1, " + amount + ",'"+hash+"', '"+comment2+"')";

            mysqlPoolQuery(q2, function (result) {
                //отправка push-уведомлений пользователю-получателю

                partnerId2pushToken( toPartner.asset_id_in_partner, function (replyPushToken) {
                    if(replyPushToken == 0) {
                        //ошибка
                        console.error("mysql.partnerId2pushToken", toPartner.id, replyPushToken);
                    } else {
                        //все ок
                        var jData = {};
                        jData.pushToken = replyPushToken;
                        jData.assetId = toPartner.asset_id_in_partner;
                        jData.msgType = "push";
                        jData.message = "Новое предложение сделки";

                        isOnline(toPartner.asset_id_in_partner, function (onlineResult) {
                            if(onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                sendSmsTaskToQueue(jData);
                            }
                        });
                    }
                });
                
                
                cb(result);//не надо помещать в блок ответа redis'а
            });
        });

    });
}




/**
 * Перевод с временного счета(актива) на актив
 * @param jsonData.actionHash
 * @param jsonData.from
 * @param jsonData.to
 * @param cb callback-функция
 */
function transferFromTemporaryAsset2Asset(jsonData, cb ) {
    //1. получаем сумму перевода (уже указана в записи для "временного актива")
    var q1 = "SELECT payment_sum FROM actions WHERE hash='"+jsonData.actionHash+"' LIMIT 1";
    mysqlPoolSelectQuery(q1, function (rows1, error_info1) {
        if(error_info1) {
            cb("error", error_info1);
            return false;
        } else if(rows1.length == 0) {
            cb("error", "action_not_found");
            return false;
        }

        var paymentSum = rows1[0].payment_sum;

        // обновляем сальдо обоих активов
        var q2 = "UPDATE assets SET saldo=CASE " +
            "WHEN id="+jsonData.from+" THEN saldo-"+paymentSum+
            " WHEN id="+jsonData.to+" THEN saldo+"+paymentSum+
            " ELSE saldo END " +
            "WHERE id IN ("+jsonData.from+","+jsonData.to+")";

        mysqlPoolQuery(q2, function (mysqlResult) {
            // * создаем запись в активе, в который перевели
            var q2 = "INSERT INTO actions(user_id, asset_id, action_type, status, from_id, to_id, " +
                "payment_sum, comment) " +
                "VALUES("+jsonData.user_id+", " + jsonData.to+", 'GET_PAYMENT', " +
                "'OK', "+jsonData.from+", "+jsonData.to+", "+paymentSum+", '')";

            mysqlPoolQuery(q2, function(mResult) {
                var newHash = sha1(Math.random());
                //обновляем запись во временном активе
                var q3 = "UPDATE actions SET status='OK', from_id="+jsonData.from+", to_id="+jsonData.to+
                    ", hash='"+newHash+"' WHERE hash='"+jsonData.actionHash+"'";
                mysqlPoolQuery(q3, function(mResult3) {
                    if(mysqlResult == "ok" && mResult == "ok" && mResult3 == "ok") {

                        //убираем временный актив, если все операции в нем обработаны
                        var q4 = "SELECT id FROM actions WHERE asset_id="+jsonData.from+" " +
                            "AND status='PENDING'";
                        mysqlPoolSelectQuery(q4, function(resultOrStatus4){
                            if(resultOrStatus4 =="error" || resultOrStatus4.length > 0) {
                                cb("ok");//INFO: здесь "ok", т.к. транзакция все равно успешно прошла
                                return false;
                            } else {
                                var q5 = "UPDATE assets SET is_visible=0 WHERE id="+jsonData.from+
                                    " AND name='temporary_asset'";
                                mysqlPoolQuery(q5, function(result5){
                                    cb(result5);
                                    return false;
                                });
                            }
                        });
                        //

                    } else {
                        cb("error");
                    }
                });
            });
        });
    });
}

/**
 * Удаление входящего перевода из временного счета
 * @param jsonData.actionHash
 * @param cb callback-функция
 */
function deleteFromTemporaryAsset(jsonData, cb ) {
    //1. получаем сумму перевода (уже указана в записи для "временного актива")
    var q1 = "SELECT asset_id, payment_sum FROM actions WHERE hash='"+jsonData.actionHash+"' LIMIT 1";
    mysqlPoolSelectQuery(q1, function (rows1, error_info1) {
        if(error_info1) {
            cb("error", error_info1);
            return false;
        } else if(rows1.length == 0) {
            cb("error", "action_not_found");
            return false;
        }

        var assetId = rows1[0].asset_id;
        var paymentSum = rows1[0].payment_sum;

        var q2 = "";
        if(paymentSum >=0) {
            //если данная запись во "временном активе" - положительная сумма, то мы уменьшаем
            //сальдо "временного актива", т.к. здесь удаляем данную запись
            q2 = "UPDATE assets SET saldo=saldo-"+paymentSum+" WHERE id="+assetId;
        } else {
            //и наоборот
            paymentSum *= -1;//делаем число "положительным"
            q2 = "UPDATE assets SET saldo=saldo+"+paymentSum+" WHERE id="+assetId;
        }

        mysqlPoolQuery(q2, function (mysqlResult) {
            var newHash = sha1(Math.random());
            //обновляем запись во "временном активе"
            var q3 = "UPDATE actions SET status='CANCEL', hash='"+newHash+"' WHERE hash='"+jsonData.actionHash+"'";
            mysqlPoolQuery(q3, function(mResult3) {
                if(mysqlResult == "ok" && mResult3 == "ok") {

                    //убираем временный актив, если все операции в нем обработаны
                    var q4 = "SELECT id FROM actions WHERE asset_id="+assetId+" " +
                        "AND status='PENDING'";
                    mysqlPoolSelectQuery(q4, function(resultOrStatus4){
                        if(resultOrStatus4 =="error" || resultOrStatus4.length > 0) {
                            cb("ok");//не все операции обработаны, но шлем "ок", т.к. главная задача выполнена
                            return false;
                        } else {
                            var q5 = "UPDATE assets SET is_visible=0 WHERE id="+assetId+
                                " AND name='temporary_asset'";
                            mysqlPoolQuery(q5, function(result5){
                                cb("ok");//все операции обработаны, сделали временный актив невидимым
                                return false;
                            });
                        }
                    });
                    //


                    cb("ok");
                } else {
                    cb("error");
                }
            });
        });
    });
}

/**
 * Перевод с актива на актив
 * @param fromAsset id актива, откуда переводим
 * @param toAsset id актива, куда переводим
 * @param userId id юзера
 * @param amount сумма зачисления на актив получения
 * @param outgoingFromAsset сумма списания с актива списания
 * @param comment1 комментарий для актива списания
 * @param comment2 комментарий для актива зачисления
 * @param cb callback-функция
 */
function transferAsset2Asset(fromAsset, toAsset, userId, amount, outgoingFromAsset, comment1, comment2, cb ) {

        // обновляем сальдо обоих активов
        var fromAssetNewSaldo = fromAsset.saldo - outgoingFromAsset;
        var toAssetNewSaldo = toAsset.saldo + amount;
        var q1 = "UPDATE assets SET saldo=CASE " +
            "WHEN id="+fromAsset.id+" THEN "+fromAssetNewSaldo +
            " WHEN id="+toAsset.id+" THEN "+toAssetNewSaldo +
            " ELSE saldo END " +
            "WHERE id IN ("+fromAsset.id+","+toAsset.id+")";

        mysqlPoolQuery(q1, function (mysqlResult) {
            // * создаем 2 записи действий - по записи для каждого из активов. запись "списано" и "пополнено"
            var q2 = "INSERT INTO actions(user_id, asset_id, action_type, status, from_id, to_id, " +
                "payment_sum, comment) " +
                "VALUES("+userId+", " + fromAsset.id+", 'SEND_PAYMENT', " +
                "'OK', "+fromAsset.id+", "+toAsset.id+", "+outgoingFromAsset+", '"+comment1+"'), " +
                "("+userId+", " + toAsset.id+", 'GET_PAYMENT', " +
                "'OK', "+fromAsset.id+", "+toAsset.id+", "+amount+", '"+comment2+"')";

            mysqlPoolQuery(q2, function(mResult, errorInfo) {
                if(mysqlResult == "ok" && mResult == "ok") {
                    cb("ok");
                } else if(mResult == "error") {
                    console.error("transferAsset2Asset", errorInfo.code, q2);
                }
                else {
                    cb("error");
                }
            });
        });
}


/*****************END TRANSFER FUNCTIONS*****************/
function mysqlPoolQuery(query, cb) {
    if(!mysqlConnection) {
        cb("error", "mysql_connection_disconnect");
        return false;
    }
    mysqlConnection.query(query, function (err, rows) {
        if (err) {
            cb("error", err);
        } else {
            cb("ok");
        }
    });
}

function mysqlPoolSelectQuery(query, cb) {
    if(!mysqlConnection) {
        cb("error", "mysql_connection_disconnect");
        return false;
    }
    mysqlConnection.query(query, function (err, rows) {
        if (err) {
            cb("error", err);
        } else {
            cb(rows);
        }
    });
}

function startTransaction() {
    if(!mysqlConnection) {
        console.log( colors.red("startTransaction.error: not found mysqlConnection") );
        handleDisconnect();
        setTimeout(startTransaction, 3000);
        return false;
    }

    mysqlConnection.query("START TRANSACTION", function (err, rows) {
        if (err) {
            console.log( colors.red("startTransaction.error: start failed.") );
            return false;
        } else {
            //
            return true;
        }
    });
}

function commitTransaction() {
    if(!mysqlConnection) {
        console.log( colors.red("commitTransaction.error: not found mysqlConnection") );
        handleDisconnect();
        setTimeout(startTransaction, 3000);
        return false;
    }
    mysqlConnection.query("COMMIT", function (err, rows) {
        if (err) {
            console.log( colors.red("commitTransaction.error: commit failed.") );
            return false;
        } else {
            return true;
        }
    });
}

function rollbackTransaction(point) {
    if(!mysqlConnection) {
        handleDisconnect();
        setTimeout(startTransaction, 3000);
        return false;
    }
    mysqlConnection.query("ROLLBACK", function (err, rows) {
        if (err) {
            console.log( colors.red("rollbackTransaction.error: rollback failed.") );
            return false;
        } else {
            return true;
        }
    });
}

function sendMessageToServer(jsonData) {

    rabbit3.then(function(connection) {
        var ok = connection.createChannel();

        ok.then(function(channel) {
            // durable: true is set by default
            channel.assertQueue("infoMessages");
            channel.assertExchange("info");
            channel.bindQueue("infoMessages", "info", "mda");

            var jsonDataString = JSON.stringify(jsonData);
            channel.publish("info", "mda", new Buffer(jsonDataString), {deliveryMode: false});
            return ok;
        }).
        then(null, console.log);
        return ok;
    }).
    then(null, console.log);
}

function sendAckToServer(jsonData, status) {

    rabbit3.then(function(connection) {
        var ok = connection.createChannel();

        ok.then(function(channel) {
            // durable: true is set by default
            channel.assertQueue("acksMessages");
            channel.assertExchange("acks");
            channel.bindQueue("acksMessages", "acks", "mda");

            jsonData.status = status;
            var jsonDataString = JSON.stringify(jsonData);
            
            channel.publish("acks", "mda", new Buffer(jsonDataString), {deliveryMode: false});
            return ok;
        }).
        then(null, console.log);
        return ok;
    }).
    then(null, console.log);

}

function sendTransferAckToServer(jsonData, status) {

    rabbit4.then(function(connection) {
        var ok = connection.createChannel();

        ok.then(function(channel) {
            // durable: true is set by default
            channel.assertQueue("acksMessages");
            channel.assertExchange("acks");
            channel.bindQueue("acksMessages", "acks", "mda");

            jsonData.status = status;
            var jsonDataString = JSON.stringify(jsonData);

            channel.publish("acks", "mda", new Buffer(jsonDataString), {deliveryMode: false});
            return ok;
        }).
        then(null, console.log);

        return ok;
    }).
    then(null, console.log);

}

function getUserAssets(jsonData, cb) {
    // var q = 'SELECT id, user_id, name, saldo, unconfirmed_incoming_deals, unconfirmed_outgoing_deals, type, partner_phone, ' +
    //     'is_cost, was_declined, last_updated ' +
    //     'FROM assets WHERE is_visible=1 AND user_id='+jsonData.user_id;


    var q = "SELECT ass.id as id, u.id as user_id, ass.name as name, ass.saldo as saldo, " +
        "ass.unconfirmed_incoming_deals as unconfirmed_incoming_deals, " +
        "ass.unconfirmed_outgoing_deals as unconfirmed_outgoing_deals, ass.type as type, " +
        "ass.partner_phone as partner_phone, ass.is_cost as is_cost, ass.was_declined as was_declined, " +
        "ass.last_updated as last_updated " +
        "FROM assets ass LEFT JOIN users as u ON u.phone=ass.partner_phone WHERE ass.is_visible=1 " +
        "AND ass.user_id="+jsonData.user_id;


    mysqlPoolSelectQuery(q, function (rows, errorInfo) {
        if(errorInfo) {
            cb("error", errorInfo);
        }
        cb(rows);
    });
}

function getAssetHistory(jsonData, cb) {
    var q = 'SELECT id, asset_id, action_type, asset_type, from_id, to_id, ' +
        'payment_sum, status, hash, comment, last_updated ' +
        'FROM actions WHERE asset_id='+jsonData.assetId+" ORDER BY id DESC LIMIT "+jsonData.offset+", 25";

    startTransaction();
    mysqlPoolSelectQuery(q, function (rows, err) {
        if(err) {
            rollbackTransaction();
            cb({status:"error", error:err.code});
        } else {
            //очищаем "индикатор отклоненной сделки, если он был ранее установлен на данном активе-партнере
            var q2 = "UPDATE assets SET was_declined=0 WHERE id="+jsonData.assetId+" AND user_id="+
                    jsonData.user_id+" AND was_declined=1 AND name<>'temporary_asset'";
            mysqlPoolQuery(q2, function (status2) {
                if(status2 == "error") {
                    rollbackTransaction();
                    cb({status:"error"});
                } else if(status2 == "ok") {
                    commitTransaction();
                    cb({status:"ok", history:rows});
                }
            });
        }
    });
}

/**
 * проверяем существование пользователя с данным номером телефона. Если найден - используем его id в качестве
 * параметра актива asset_id_in_partner. Если не найден - создаем и затем используем id в качестве параметра актива
 * asset_id_in_partner
 * @param jsonData
 * @param cb
 */
function addPartnerStep1(jsonData, cb) {
    console.log("worker.addPartner", jsonData);

    var q1 = "SELECT id FROM users WHERE phone="+jsonData.partnerPhone+" LIMIT 1";

    mysqlPoolSelectQuery(q1, function (rows) {
        //если юзер не найден - создаем его и используем его id
        if(rows.length == 0) {
            var newToken = sha1(new Date().getTime());
            var q2 = "INSERT INTO users(name, phone, token) VALUES("+jsonData.partnerPhone+", "+
                jsonData.partnerPhone+",'"+newToken+"')";
            mysqlPoolSelectQuery(q2, function (r) {
                // добавляем новому юзеру(партнеру) 4 актива и 5 категорий расходов "по умолчанию"
                var userId = r.insertId;
                var q21 = "INSERT INTO assets(user_id, name, type, is_cost, is_visible) " +
                    "VALUES("+userId+", 'Банковская карта','asset', 0, 1), " +
                    "("+userId+", 'Кошелек','asset', 0, 1), " +
                    "("+userId+", 'Сбережения','asset', 0, 1), " +
                    "("+userId+", 'Склад','asset', 0, 1), " +
                    "("+userId+", 'Развлечения','asset', 1, 1), " +
                    "("+userId+", 'Дорога','asset', 1, 1), " +
                    "("+userId+", 'Семья','asset', 1, 1), " +
                    "("+userId+", 'temporary_asset','asset', 1, 1)";

                mysqlPoolSelectQuery(q21, function(rowsOrStatus21, err21) {

                    if(err21) {
                        cb("error", err21.code);
                        return false;
                    }

                    //добавляем нового пользователя в чат
                    var regChatMsg = {};
                    regChatMsg.action = "addNewUser";
                    regChatMsg.login = jsonData.partnerPhone;
                    regChatMsg.password = newToken;
                    sendToChatQueue(regChatMsg);


                        addPartnerStep2(r.insertId, jsonData, function (status, insertId) {
                            //обновляем redis-кэш
                            var userObj = {
                                id: r.insertId,
                                name:"",
                                address:"",
                                business:"",
                                position:"",
                                requisites:"",
                                phone: jsonData.partnerPhone,
                                token:newToken
                            };

                            var jsonUserObj = JSON.stringify(userObj);
                            var jsonUserData = {id:r.insertId, phone:jsonData.partnerPhone};
                            var jsonUserDataString = JSON.stringify(jsonUserData);
                            redisClient.hset("users", newToken, jsonUserDataString);//<token>-<user_id>
                            redisClient.hset("users", jsonData.partnerPhone, jsonUserObj);

                            cb(status, insertId);
                        });
                    });
                });
        } else {
            //если юзер найден - используем его id
            addPartnerStep2(rows[0].id, jsonData, function (status, insertId) {

                if(status == "ok") {

                    // var regChatMsg = {};
                    // regChatMsg.action = "changePassword";
                    // regChatMsg.login = jsonData.phone;
                    // regChatMsg.password = newToken;
                    // sendToChatQueue(regChatMsg);

                    cb(status, insertId);
                } else {
                    cb("error", "error_add_user_to_chat");
                }

            });
        }
    });
}

/**
 * Добавляем актив типа "партнер" непосредственно в базу данных. для текущего юзера.
 * А для юзера-партнера создаем актив типа "партнер", указывая id актива данного юзера в качестве id актива-партнера.
 * @param partnerUserId
 * @param cb
 */
function addPartnerStep2(partnerUserId, params, cb) {

    var isCost = params.isCost || 0;

    //создаем актив-партнер у юзера, инициализировавшего добавление партнера. Пока что без asset_id_in_partner
    //1. проверяем, не существует ли уже такой актив у юзера, которого добавляем в партнеры
    var q1 = "SELECT id FROM assets WHERE user_id="+params.user_id+" AND partner_phone="+params.partnerPhone;
    mysqlPoolSelectQuery(q1, function (rowsResult) {
        //2. если существует - обновляем (или что-то еще делаем) (см. ниже, блок else)
        var recepientUserAssetId;
        var senderUserAssetId;
        //3. если не существует - создаем
        if(rowsResult.length == 0) {
            //3.1 проверяем существование самого юзера (партнера)
            //INFO: юзер УЖЕ существует априори. он создается на шаге 1.
            //создаем актив-партнер у юзера-получателя
            //сперва проверяем существование такого актива у юзера-получателя
            var q2 = "SELECT id FROM assets WHERE user_id="+partnerUserId+" AND partner_phone="+params.myPhone;
            mysqlPoolSelectQuery(q2, function (rows2) {
                //если такого актива не существует - создаем его
                if(rows2.length == 0) {
                    var q3 = "INSERT INTO assets(user_id, name, saldo, type, partner_phone, " +
                        "is_cost) " +
                        "VALUES("+partnerUserId+", "+params.myPhone+", "+ -params.saldo+", 'partner', "+
                        params.myPhone+", "+isCost+")";
                    mysqlPoolSelectQuery(q3, function (rows3) {
                        recepientUserAssetId = rows3.insertId;
                        //создаем актив-партнер у юзера-отправителя
                        var q33 = "INSERT INTO assets(user_id, name, saldo, type, partner_phone, " +
                            "is_cost) " +
                            "VALUES(" + params.user_id + ", '" + params.name + "', " + params.saldo +
                            ", 'partner', " +
                            params.partnerPhone + ", "+isCost+") " +
                            "ON DUPLICATE KEY UPDATE type='asset'";

                        mysqlPoolSelectQuery(q33, function (rows33) {
                            senderUserAssetId = rows33.insertId;//это подставим в asset_id_in_partner другого актива
                            //обновляем значения asset_id_in_partner у обоих только что созданных активов
                            var q4 = "UPDATE assets SET asset_id_in_partner = CASE id " +
                                "WHEN " + recepientUserAssetId + " THEN " + senderUserAssetId +
                                " WHEN " + senderUserAssetId + " THEN " + recepientUserAssetId +
                                " ELSE asset_id_in_partner END, " +
                                "is_visible=1 " +
                                "WHERE id IN("+recepientUserAssetId+", "+senderUserAssetId+")";//TODO: проверить
                            mysqlPoolQuery(q4, function (status4) {
                                cb(status4, rows33.insertId);
                            });
                        });
                    });

                } else {// если существует - получаем из него id для
                    recepientUserAssetId = rows2[0].id;
                    //создаем актив-партнер у юзера-отправителя
                    var q3 = "INSERT INTO assets(user_id, name, saldo, type, partner_phone, " +
                        "is_cost) " +
                        "VALUES(" + params.user_id + ", " + params.partnerPhone + ", " + params.saldo +
                        ", 'partner', " +
                        params.partnerPhone + ", "+isCost+") " +
                        "ON DUPLICATE KEY UPDATE is_visible=1";
                    mysqlPoolSelectQuery(q3, function (rows3) {
                        senderUserAssetId = rows3.insertId;//это подставим в asset_id_in_partner другого актива
                        //обновляем значения asset_id_in_partner у обоих только что созданных активов
                        var q4 = "UPDATE assets SET asset_id_in_partner = CASE id " +
                            "WHEN " + recepientUserAssetId + " THEN " + senderUserAssetId +
                            " WHEN " + senderUserAssetId + " THEN " + recepientUserAssetId +
                            " ELSE asset_id_in_partner END, " +
                            "is_visible=1";//TODO: проверить
                        mysqlPoolQuery(q4, function (status4) {
                            cb(status4, rows3.insertId);
                        });
                    });
                }
            });

        } else {
            //если актив-партнер уже существует у юзера-отправителя
            //создаем актив-партнер у юзера-получателя
            //сперва проверяем существование такого актива у юзера-получателя
            var q5 = "SELECT id, asset_id_in_partner FROM assets WHERE user_id="+partnerUserId+" AND " +
                "partner_phone="+params.myPhone;
            mysqlPoolSelectQuery(q5, function (rows5) {
                //если такого актива не существует - создаем его
                if(rows5.length == 0) {
                    var isCost = params.isCost || 0;
                    var q6 = "INSERT INTO assets(user_id, name, saldo, type, partner_phone, " +
                        "is_cost) " +
                        "VALUES("+partnerUserId+", "+params.myPhone+", "+ -params.saldo+", 'partner', "+
                        params.myPhone+", "+isCost+")";
                    mysqlPoolSelectQuery(q6, function (rows6) {
                        recepientUserAssetId = rows6.insertId;
                        senderUserAssetId = rowsResult[0].id;//id актива-отправителя
                        //обновляем значения asset_id_in_partner у обоих только что созданных активов
                        var q8 = "UPDATE assets SET asset_id_in_partner = CASE id " +
                            "WHEN " + recepientUserAssetId + " THEN " + senderUserAssetId +
                            " ELSE asset_id_in_partner END, " +
                            "is_visible=1 " +//TODO: проверить
                            "WHERE id="+recepientUserAssetId;
                        mysqlPoolQuery(q8, function (status8) {
                            cb(status8, rows6.insertId);
                        });
                    });

                } else {// если существует - делаем видимым (если был "удален")
                    //id того актива-партнера, который нужно сделать видимым
                    var userPartnerAssetId = -1;
                    var q9 = "UPDATE assets SET is_visible=1 " +//TODO: проверить
                    "WHERE id="+rows5[0].asset_id_in_partner;
                    mysqlPoolQuery(q9, function (status9) {
                        cb(status9);
                    });
                }
            });
        }
    });
}


function declineTransfer(jsonData, cb) {
    //отклоняем входящий перевод для юзера-получателя
    //меняем статус действия на DECLINE
    /*to_id !=0 - исключает из выборки запись получателя. У получателя мы не указываем to_id, поскольку он не
     подтвердил получение перевода. А в данной функции он его отклоняет.*/
    var hash = jsonData.actionHash;
    var newHash = sha1(new Date().getTime());
    var q_0 = "SELECT user_id, asset_id, action_type, asset_type, payment_sum, from_id, to_id, last_updated " +
        "FROM actions " +
        "WHERE hash='" +jsonData.actionHash + "' " +
        "AND user_id<>"+jsonData.user_id+//запрет на подтвердждение/отклонение своих дейтвий
        " LIMIT 3";
    mysqlPoolSelectQuery(q_0, function (rows_0) {

        if(rows_0.length < 2) {
            console.log(colors.red("worker.declineTransfer.error: rows_0.length < 2"));
            cb("error");
            return false;
        }

        var last_updated = rows_0[0].last_updated / 1000;
        var from_id = rows_0[0].from_id;
        var to_id = rows_0[0].to_id;
        var asset_id = rows_0[0].asset_id;

        //проверяем - есть ли более ранние не подтвержденные сделки.
        // если есть - не позволяем выполнить текущую операцию
        var q0 = "SELECT last_updated FROM actions WHERE last_updated < FROM_UNIXTIME(" + last_updated + ")" +
            " AND status='PENDING' AND to_id="+to_id+" AND from_id="+from_id+" " +"AND asset_id="+asset_id+
            " AND (action_type='SEND_OUTGOING_PAYMENT_REQUEST' OR action_type='SEND_INCOMING_PAYMENT_REQUEST')";

        mysqlPoolSelectQuery(q0, function (rows0) {
            if (rows0.length > 0) {
                cb("error", "processing_erly_actions_before");//Обработайте сперва более ранние транзакции
                return false;
            }


            //отменяеем перевод типа партнер-партнер
            if (rows_0.length == 2 && //partner->partner
                rows_0[0].asset_type == "partner" && rows_0[1].asset_type == "partner" ) {

                var partnerFromId = rows_0[0].asset_id == rows_0[0].from_id ? rows_0[0].asset_id :
                    rows_0[1].asset_id == rows_0[1].from_id ? rows_0[1].asset_id : -1;

                var partnerToId = rows_0[0].asset_id == rows_0[0].to_id ? rows_0[0].asset_id :
                    rows_0[1].asset_id == rows_0[1].to_id ? rows_0[1].asset_id : -1;

                var isSenderAndHisIdIs = rows_0[0].action_type == 'GET_OUTGOING_PAYMENT_REQUEST' &&
                    rows_0[0].from_id == -1 ? rows_0[0].asset_id :
                    rows_0[1].action_type == 'GET_OUTGOING_PAYMENT_REQUEST' &&
                    rows_0[1].from_id == -1 ? rows_0[1].asset_id : false;

                var isGetterAndHisIdIs = rows_0[0].action_type == 'GET_INCOMING_PAYMENT_REQUEST' &&
                rows_0[0].to_id == -1 ? rows_0[0].asset_id :
                    rows_0[1].action_type == 'GET_INCOMING_PAYMENT_REQUEST' &&
                    rows_0[1].to_id == -1 ? rows_0[1].asset_id : false;


                var outgoingSum = rows_0[0].action_type == 'GET_OUTGOING_PAYMENT_REQUEST' &&
                rows_0[0].from_id == -1 ? rows_0[0].payment_sum :
                    rows_0[1].action_type == 'GET_OUTGOING_PAYMENT_REQUEST' &&
                    rows_0[1].from_id == -1 ? rows_0[1].payment_sum : false;


                var incomingSum = rows_0[0].action_type == 'GET_INCOMING_PAYMENT_REQUEST' &&
                rows_0[0].to_id == -1 ? rows_0[0].payment_sum :
                    rows_0[1].action_type == 'GET_INCOMING_PAYMENT_REQUEST' &&
                    rows_0[1].to_id == -1 ? rows_0[1].payment_sum : false;

                var q_1 = "UPDATE actions SET status=CASE " +
                    "WHEN asset_type='partner' THEN 'DECLINE' " +
                    //устанавливаем значение DECLINE для активов-партнеров
                    "ELSE status END, " +
                    "hash = CASE " +
                    "WHEN hash='" + hash + "' THEN '" + newHash + "' " +
                    "ELSE hash END " +
                    "WHERE hash='" + hash + "' AND user_id<>" + jsonData.user_id;

                mysqlPoolQuery(q_1, function (status) {
                    //возвращаем запрошенные (или списываем отправленные) средства на временный счет
                    //а так же возвращаем сальдо назад
                    //и устанавливаем на бейджи меньшее значение

                    var q2 = "";
                    if(isSenderAndHisIdIs) {

                        q2 = "UPDATE assets SET saldo=CASE " +
                            //для инициатора перевода партнер-партнер
                            " WHEN id=" +partnerFromId+" THEN saldo+"+outgoingSum+
                            " ELSE saldo END, " +

                            "unconfirmed_outgoing_deals=CASE " +
                            " WHEN id=" +partnerFromId+" THEN unconfirmed_outgoing_deals-1 " +
                            "ELSE unconfirmed_outgoing_deals END, "+

                            "unconfirmed_incoming_deals=CASE " +
                            " WHEN id=" +isSenderAndHisIdIs+" THEN unconfirmed_incoming_deals-1 " +
                            "ELSE unconfirmed_incoming_deals END, "+

                            "was_declined=CASE " +
                            " WHEN id=" +partnerFromId+" THEN 1 " +
                            "ELSE was_declined END "+

                            "WHERE id IN("+partnerFromId+", "+isSenderAndHisIdIs+")";

                    } else if(isGetterAndHisIdIs) {
                        q2 = "UPDATE assets SET saldo=CASE " +
                            //для инициатора перевода партнер-партнер
                            " WHEN id=" +partnerToId+" THEN saldo-"+incomingSum+
                            " ELSE saldo END, " +

                            "unconfirmed_outgoing_deals=CASE " +
                            " WHEN id=" +partnerToId+" THEN unconfirmed_outgoing_deals-1 " +
                            "ELSE unconfirmed_outgoing_deals END, "+

                            "unconfirmed_incoming_deals=CASE " +
                            " WHEN id=" +isGetterAndHisIdIs+" THEN unconfirmed_incoming_deals-1 " +
                            "ELSE unconfirmed_incoming_deals END, "+

                            "was_declined=CASE " +
                            " WHEN id=" +partnerToId+" THEN 1 " +
                            "ELSE was_declined END "+

                            "WHERE id IN("+partnerToId+", "+isGetterAndHisIdIs+")";
                    }

                    mysqlPoolSelectQuery(q2, function (rows2, error) {

                        var q_3 ="SELECT id FROM assets WHERE user_id="+rows_0[0].user_id+
                            " AND name='temporary_asset' LIMIT 1";

                        mysqlPoolSelectQuery(q_3, function (rows_3, error3) {

                            if(error3) {
                                cb("error", error3.code);
                                return false;
                            }

                            if(rows_3.length == 0) {
                                cb("error", "user_not_found");
                                return false;
                            }

                            var temporaryAssetId = rows_3[0].id;

                            var  sum = outgoingSum || incomingSum;

                            var partnerFromIdForInsertTemporaryAsset = outgoingSum ? partnerFromId : -1;

                            var partnerToIdForInsertTemporaryAsset = incomingSum ? partnerToId: -1;

                            //записываем в историю временного актива сообщение о том, что произошло
                            var newHashForTemporaryAsset = sha1(Math.random());

                            var q3 = "";

                            if(outgoingSum) {
                                q3 = "INSERT INTO actions(user_id, asset_id, action_type, from_id, to_id, " +
                                    "payment_sum, hash, status) VALUES(" + rows_0[0].user_id + ", " +
                                    temporaryAssetId+", 'GET_PAYMENT', "+
                                    partnerFromIdForInsertTemporaryAsset+", "+partnerToIdForInsertTemporaryAsset+", "+
                                    -sum +", '"+newHashForTemporaryAsset+"', 'PENDING')";
                            } else if (incomingSum) {
                                q3 = "INSERT INTO actions(user_id, asset_id, action_type, from_id, to_id, " +
                                    "payment_sum, hash, status) VALUES(" + rows_0[0].user_id + ", " +
                                    temporaryAssetId+", 'GET_PAYMENT', "+
                                    partnerFromIdForInsertTemporaryAsset+", "+partnerToIdForInsertTemporaryAsset+", "+
                                    sum +", '"+newHashForTemporaryAsset+"', 'PENDING')";
                            } else {
                                cb("error");
                            }

                            mysqlPoolSelectQuery(q3, function (rows3) {

                                var q4 = "";
                                //INFO: здесь знак сальдо изменен на противоположный
                                if(outgoingSum) {
                                    q4 = "UPDATE assets SET saldo=saldo-"+outgoingSum+", is_visible=1" +
                                        " WHERE id="+temporaryAssetId;
                                } else if (incomingSum) {
                                    q4 = "UPDATE assets SET saldo=saldo+"+incomingSum+", is_visible=1" +
                                        " WHERE id="+temporaryAssetId;
                                } else {
                                    cb("error");
                                    return false;
                                }

                                //пополняем(или уменьшаем) счет временного актива
                                mysqlPoolSelectQuery(q4, function (rows4) {

                                    console.log(isSenderAndHisIdIs, isGetterAndHisIdIs, partnerFromId, partnerToId);

                                    //отправляем оповещение инициатору сделки
                                    //INFO: сделаны и работают пуши для:
                                    //прямого перевода и подтверждений/отклонений прямой и обратной сделки, сальдо
                                    //подтверждение/отклонение сальдо
                                    // отклонение перевода партнер-партнер, при отклонении
                                    // с "партнер 0 -> партнер 1" (отклоняю на "партнер 1")

                                    // так же в одном из вариантов отклонения перевода партнер-партнер
                                    //нет значка отклоненной сделки

                                    if(isSenderAndHisIdIs) {

                                        partnerId2pushToken(partnerFromId,
                                            function (replyPushToken) {

                                                if (replyPushToken == 0) {
                                                    //ошибка
                                                } else {
                                                    //все ок
                                                    var jData = {};
                                                    jData.pushToken = replyPushToken;
                                                    jData.assetId = partnerFromId;
                                                    jData.msgType = "push";//or "push"
                                                    jData.message = "Сделка отклонена";

                                                    isOnline(partnerToId, function (onlineResult) {
                                                        if (onlineResult) {
                                                            //online
                                                            jData.socketId = onlineResult;
                                                            sendWsMessageTaskToQueue(jData);
                                                        } else {
                                                            //offline
                                                            sendSmsTaskToQueue(jData);
                                                        }
                                                    });
                                                }
                                            });
                                        
                                    } else if(isGetterAndHisIdIs) {

                                        partnerId2pushToken(partnerToId,
                                            function (replyPushToken) {

                                                if (replyPushToken == 0) {
                                                    //ошибка
                                                    console.log("declineTransfer.mysql.error",partnerFromId, 
                                                        replyPushToken);
                                                } else {
                                                    //все ок
                                                    var jData = {};
                                                    jData.pushToken = replyPushToken;
                                                    jData.assetId = partnerToId;
                                                    jData.msgType = "push";//or "push"
                                                    jData.message = "Сделка отклонена";

                                                    isOnline(partnerToId, function (onlineResult) {
                                                        if (onlineResult) {
                                                            //online
                                                            jData.socketId = onlineResult;
                                                            sendWsMessageTaskToQueue(jData);
                                                        } else {
                                                            //offline
                                                            sendSmsTaskToQueue(jData);
                                                        }
                                                    });
                                                }
                                            });
                                        
                                    }

                                    cb("ok");
                                });

                            });
                        });
                    });

                });

                return false;
            }//end partner-to-partner decline transfer


            //DECLINE partner2asset and asset2partner transfers

            //INFO: этот newHash используется для ЗАМЕНЫ текущего хэша операции перевода.
            //смысл действия: избежать случайного дублирования запроса,
            // в случае лишь частичного выполнения цепочки запросов.

            var q1 = "UPDATE actions SET status=CASE " +
                "WHEN asset_type='partner' THEN 'DECLINE' " + //устанавливаем значение DECLINE для активов-партнеров
                "WHEN asset_type='asset' THEN 'CANCEL' " + //устанавливаем значение CANCEL для актива списания
                "ELSE status END, " +
                "hash = CASE " +
                "WHEN hash='" + hash + "' THEN '" + newHash + "' " +
                "ELSE '" + newHash + "' END " +
                "WHERE hash='" + hash + "' AND user_id<>" + jsonData.user_id;

            mysqlPoolQuery(q1, function (status) {

                //возвращаем обратно в актив средства, списанные при транзакции
                //получаем списанную с актива списания сумму и сумму, зачисленную на актив-партнер
                /*to_id !=0 - исключает из выборки запись получателя. У получателя мы не указываем to_id,
                поскольку он не подтвердил получение перевода. А в данной функции он его отклоняет.*/
                var q2 = "SELECT asset_id, asset_type, payment_sum, from_id, to_id FROM actions WHERE hash='" +
                    newHash + "' AND user_id<>" + jsonData.user_id +" LIMIT 3";

                mysqlPoolSelectQuery(q2, function (rows2) {

                    if (rows2.length == 0) {
                        cb("error");
                        return false;
                    }

                    var paybackToAsset = rows2[0].asset_type == "asset" ? rows2[0].payment_sum : rows2[1].payment_sum;
                    var paybackToAssetId = rows2[0].asset_type == "asset" ? rows2[0].asset_id : rows2[1].asset_id;

                    var paybackToPartner = rows2[0].asset_type == "partner" ? rows2[0].payment_sum:rows2[1].payment_sum;
                    var paybackToPartnerId = rows2[0].asset_type == "partner" ? rows2[0].asset_id : rows2[1].asset_id;

                    //INFO: определяем тип сделки: актив->партнер, партнер->актив, партнер->партнер
                    var actionType = "";
                    if (rows2[0].asset_id == rows2[0].from_id && rows2[0].asset_type == "asset"
                        ||
                        rows2[1].asset_id == rows2[1].from_id && rows2[1].asset_type == "asset") {
                        actionType = "asset2partner";
                    } else if (rows2[0].asset_id == rows2[0].from_id && rows2[0].asset_type == "partner"
                        ||
                        rows2[1].asset_id == rows2[1].from_id && rows2[1].asset_type == "partner") {
                        actionType = "partner2asset";
                    } else {
                        actionType = "unknownType";
                        cb("error");
                        return false;
                    }

                    //для unconfirmed_deals
                    var fromOrToId,
                    //в зависимости от типа сделки - подставляем кусок кода для 3-го актива
                    unconfirmedFromOrToBlockCode;

                    var newAssetSaldo = "";
                    var newPartnerSaldo = "";

                    //если отменен перевод с актива на партнера (получатель средств отменил перевод)
                    if (actionType == "asset2partner") {
                        //добавляем на актив
                        newAssetSaldo = "saldo+" + paybackToAsset;
                        //и вычитаем из партнера
                        newPartnerSaldo = "saldo-" + paybackToPartner;
                        //from(?)
                        fromOrToId = rows2[2].to_id == -1 ? rows2[2].from_id : -1;

                        var q5 = "UPDATE assets SET saldo=CASE " +
                            "WHEN id=" + paybackToAssetId + " THEN " + newAssetSaldo + " " +
                            "WHEN id=" + paybackToPartnerId + " THEN " + newPartnerSaldo + " " +
                            "ELSE saldo END, " +

                            "unconfirmed_outgoing_deals=CASE "+
                            "WHEN id=" + paybackToPartnerId + " THEN unconfirmed_outgoing_deals-1 " +
                            " ELSE unconfirmed_outgoing_deals END, " +

                            "unconfirmed_incoming_deals=CASE "+
                            "WHEN id=" + fromOrToId  + " THEN unconfirmed_incoming_deals-1 " +
                            " ELSE unconfirmed_incoming_deals END, " +

                            "was_declined=CASE "+
                            "WHEN id=" + paybackToPartnerId + " THEN 1 " +
                            " ELSE was_declined END " +

                            "WHERE id IN(" + paybackToAssetId + "," + paybackToPartnerId + ", " + fromOrToId + ")";
                    } else if (actionType == "partner2asset") {//если отменен перевод с партнера на актив
                        //вычитаем из актива, на который хотели получить зачисление
                        newAssetSaldo = "saldo-" + paybackToAsset;
                        //и добавляем обратно партнеру, с которого хотели получить перевод
                        newPartnerSaldo = "saldo+" + paybackToPartner;
                        //to
                        fromOrToId = rows2[2].from_id == -1 ? rows2[2].to_id : -1;

                        var q5 = "UPDATE assets SET saldo=CASE " +
                            "WHEN id=" + paybackToAssetId + " THEN " + newAssetSaldo + " " +
                            "WHEN id=" + paybackToPartnerId + " THEN " + newPartnerSaldo + " " +
                            "ELSE saldo END, " +
                            "unconfirmed_outgoing_deals=CASE "+
                            "WHEN id=" + paybackToPartnerId  + " THEN unconfirmed_outgoing_deals-1 " +
                            " ELSE unconfirmed_outgoing_deals END, " +

                            "unconfirmed_incoming_deals=CASE "+
                            "WHEN id=" + fromOrToId + " THEN unconfirmed_incoming_deals-1 " +
                            " ELSE unconfirmed_incoming_deals END, " +

                            "was_declined=CASE "+
                            "WHEN id=" + paybackToPartnerId  + " THEN 1 " +
                            " ELSE was_declined END " +

                            "WHERE id IN(" + paybackToAssetId + "," + paybackToPartnerId + ", " + fromOrToId + ")";

                    }

                    var q4 = "SELECT asset_id_in_partner FROM assets WHERE id=" + paybackToPartnerId;
                    mysqlPoolSelectQuery(q4, function (rows4, errorInfo) {

                        if(rows4 == "error") {
                            console.error("partner2asset.errorInfo", errorInfo.code, rows4);
                            cb("error", errorInfo.code);
                            return false;
                        }

                        if (rows4.length == 0) {
                            cb("error");
                            return false;
                        }

                        mysqlPoolQuery(q5, function (status5) {
                            //отправка push-уведомлений пользователю-получателю
                            if(actionType == "asset2partner") {
                                partnerId2pushToken(
                                    paybackToPartnerId, function (replyPushToken) {

                                        if (replyPushToken == 0) {
                                            //ошибка
                                            console.log("declineTransfer(2).mysql.error", paybackToPartnerId, replyPushToken);
                                        } else {
                                            //все ок
                                            var jData = {};
                                            jData.pushToken = replyPushToken;
                                            jData.assetId = paybackToPartnerId;
                                            jData.msgType = "push";//or "push"
                                            jData.message = "Сделка отклонена";

                                            isOnline(paybackToPartnerId, function (onlineResult) {
                                                if(onlineResult) {
                                                    //online
                                                    jData.socketId = onlineResult;
                                                    sendWsMessageTaskToQueue(jData);
                                                } else {
                                                    //offline
                                                    sendSmsTaskToQueue(jData);
                                                }
                                            });
                                        }
                                });
                            } else if(actionType == "partner2asset") {
                                partnerId2pushToken(
                                    paybackToPartnerId, function (replyPushToken) {

                                        if (replyPushToken == 0) {
                                            //ошибка
                                            console.log("declineTransfer(2).mysql.error", paybackToPartnerId, replyPushToken);
                                        } else {
                                            //все ок
                                            var jData = {};
                                            jData.pushToken = replyPushToken;
                                            jData.assetId = paybackToPartnerId;
                                            jData.msgType = "push";//or "push"
                                            jData.message = "Сделка отклонена";

                                            isOnline(paybackToPartnerId, function (onlineResult) {
                                                if(onlineResult) {
                                                    //online
                                                    jData.socketId = onlineResult;
                                                    sendWsMessageTaskToQueue(jData);
                                                } else {
                                                    //offline
                                                    sendSmsTaskToQueue(jData);
                                                }
                                            });
                                        }
                                    });
                            }
                            
                            cb(status5);
                        });
                    });
                });
            });
        });
    });
}


function acceptTransfer(jsonData, cb) {
    //подтверждаем входящий перевод для юзера-получателя
    //меняем статус действия на ACCEPT

    var params = {};

    //TODO: добавить на каждом запросе проверку результата выполнения запроса(успешно или не успешно)
    var hash = jsonData.actionHash;
    var transferAssetId = jsonData.transferAssetId;//актив, на который получаем (или с которого списываем) средства

    //INFO: ВАЖНО: этот newHash используется для ЗАМЕНЫ текущего хэша операции перевода.
    //смысл действия: избежать случайного дублирования запроса,
    // в случае лишь частичного выполнения цепочки запросов.

    var newHash = sha1(new Date().getTime());


    /*to_id !=0 - исключает из выборки запись получателя. У получателя мы не указываем to_id, поскольку он не
     подтвердил получение перевода. А в данной функции он его отклоняет.*/
    var q1 = "SELECT asset_id, asset_type, action_type, payment_sum, from_id, to_id, last_updated " +
        "FROM actions WHERE hash='" + hash + "' AND user_id<>"+jsonData.user_id+
        " LIMIT 3";

    mysqlPoolSelectQuery(q1, function (rows1) {

        //INFO: устарело с появлением перевода типа "партнер -> партнер"
          if (rows1.length < 2) {
            console.log(colors.red("worker.acceptTransfer.error: rows1.length < 2"));
            cb("error");
            return false;
        }

        //id актива-партнера у юзера-получателя, с которого вычитаем сальдо
        // (когда др. юзер запросил входящий перевод)
        var transferPartnerFromId;
        var partnerToId;//тот id актива-партнера, на который 1-й юзер отправил перевод

        //Ниже идут различные варианты подтверждения перевода между активами и партнерами
        var transferToAsset = rows1[0].asset_type == "asset" ? rows1[0].payment_sum : rows1[1].payment_sum;

        var transferToPartner = rows1[0].asset_type == "partner" ? rows1[0].payment_sum : rows1[1].payment_sum;
        var transferToPartnerId = rows1[0].asset_type == "partner" ? rows1[0].asset_id : rows1[1].asset_id;

        var newAssetSaldo = "";
        var newPartnerSaldo = "";



        //INFO: определяем тип сделки: актив->партнер, партнер->актив, партнер->партнер
        var actionType = "";
        if (rows1.length == 2 && //partner->partner
            rows1[0].asset_type == "partner" && rows1[1].asset_type == "partner" ) {

            //INFO: здесь подтверждение перевода с партнера на партнера
            transferPartnerFromId = rows1[0].to_id == -1 ? rows1[0].from_id :
                rows1[1].to_id == -1 ? rows1[1].from_id : -1;

            //Ниже идут различные варианты подтверждения перевода между активами и партнерами
            transferToAsset = rows1[0].asset_type == "asset" ? rows1[0].payment_sum : rows1[1].payment_sum;

            transferToPartner = rows1[0].asset_type == "partner" ? rows1[0].payment_sum : rows1[1].payment_sum;
            transferToPartnerId = rows1[0].asset_type == "partner" ? rows1[0].asset_id : rows1[1].asset_id;

            //переменная показывает, какой тип действия предлагается данному юзеру - отправить или получить перевод
            var userActionType = rows1[0].action_type == "GET_OUTGOING_PAYMENT_REQUEST" ?
                'GET_OUTGOING_PAYMENT_REQUEST' : rows1[0].action_type == 'GET_INCOMING_PAYMENT_REQUEST' ?
                'GET_INCOMING_PAYMENT_REQUEST' : rows1[1].action_type == "GET_OUTGOING_PAYMENT_REQUEST" ?
                'GET_OUTGOING_PAYMENT_REQUEST' : rows1[1].action_type == 'GET_INCOMING_PAYMENT_REQUEST' ?
                'GET_INCOMING_PAYMENT_REQUEST' : 'unknown';

            if( userActionType == 'unknown' ) {
                console.log( colors.red("error: userActionType is unknown") );
                cb("error");
                return false;
            }

            partnerToId = rows1[0].to_id;//INFO: Это нужно для убирания бейджа, при подтверждении

            //TODO: протестить этот блок кода
            newAssetSaldo = "saldo+" + transferToPartner;//transferToAsset;
            //и вычитаем из партнера
            newPartnerSaldo = "saldo-" + transferToPartner;
            params.transferToAsset = transferToAsset;
            params.transferToAssetId = transferAssetId;//transferToAssetId;
            params.transferToPartner = transferToPartner;
            params.transferPartnerFromId = transferPartnerFromId;
            params.transferPartnerToId = partnerToId;
            params.newAssetSaldo = newAssetSaldo;
            params.newPartnerSaldo = newPartnerSaldo;
            params.hash = hash;
            params.newHash = newHash;
            params.user_id = jsonData.user_id;
            params.last_updated = Date.parse(rows1[0].last_updated) / 1000;
            params.to_id = rows1[0].to_id;
            params.from_id = rows1[0].from_id;
            params.userActionType = userActionType;

            acceptTransferPartner2Partner(params, function (status, error_info) {
                cb(status, error_info);
            });
            return false;
            //конец перевода с партнера на партнера
        } else if (rows1[0].asset_id == rows1[0].from_id && rows1[0].asset_type == "asset"
            ||
            rows1[1].asset_id == rows1[1].from_id && rows1[1].asset_type == "asset") {

            actionType = "asset2partner";
            partnerToId = rows1[0].to_id;//INFO: Это нужно для убирания бейджа, при подтверждении
        } else if (rows1[0].asset_id == rows1[0].from_id && rows1[0].asset_type == "partner"
            ||
            rows1[1].asset_id == rows1[1].from_id && rows1[1].asset_type == "partner") {
            actionType = "partner2asset";
        } else {
            actionType = "unknownType";//TODO: обработать и такую ситуацию, на всякий случай
            console.log( colors.red("error: "),actionType);
            cb("error");
            return false;
        }


        transferPartnerFromId = rows1[0].to_id == -1 ? rows1[0].from_id :
            rows1[1].to_id == -1 ? rows1[1].from_id :
                rows1[2].to_id == -1 ? rows1[2].from_id : -1;


        //если подтвержден перевод с актива на партнера (получатель средств подтвердил входящий перевод)
        if (actionType == "asset2partner") {

            if( transferPartnerFromId == -1) {
                console.log(colors.red("worker.acceptTransfer.error: transferPartnerFromId == -1"));
                cb("error");
                return false;
            }

            //добавляем на актив
            newAssetSaldo = "saldo+" + transferToPartner;//transferToAsset;
            //и вычитаем из партнера
            newPartnerSaldo = "saldo-" + transferToPartner;
            params.transferToAsset = transferToAsset;
            params.transferToAssetId = transferAssetId;//transferToAssetId;
            params.transferToPartner = transferToPartner;
            params.transferToPartnerId =  partnerToId;
            params.transferPartnerFromId = transferPartnerFromId;
            params.transferPartnerToId = partnerToId;
            params.newAssetSaldo = newAssetSaldo;
            params.newPartnerSaldo = newPartnerSaldo;
            params.hash = hash;
            params.newHash = newHash;
            params.user_id = jsonData.user_id;
            params.last_updated = Date.parse(rows1[0].last_updated) / 1000;
            params.to_id = rows1[0].to_id;
            params.from_id = rows1[0].from_id;

            acceptTransferAsset2Partner(params, function (status, error_info) {
                cb(status, error_info);
            });

        } else if (actionType == "partner2asset") { //если подтвержден перевод с партнера на актив
            //вычитаем из актива, на который хотели получить зачисление
            newAssetSaldo = "saldo-" + transferToAsset;
            //и добавляем обратно партнеру, с которого хотели получить перевод
            newPartnerSaldo = "saldo+" + transferToPartner;

            var forUnconfirmedDeals1 = rows1[0].asset_id == rows1[0].from_id ? rows1[0].from_id : -1;
            var forUnconfirmedDeals2 = rows1[2].asset_id == rows1[2].to_id ? rows1[2].to_id : -1;

            params.transferToAsset = transferToAsset;
            // params.transferToAssetId = transferToAssetId;
            params.transferToAssetId = transferAssetId;//transferToAssetId;
            params.transferToPartner = transferToPartner;
            params.transferPartnerFromId = transferPartnerFromId;
            params.newAssetSaldo = newAssetSaldo;
            params.newPartnerSaldo = newPartnerSaldo;
            params.hash = hash;
            params.newHash = newHash;
            params.user_id = jsonData.user_id;
            params.last_updated = Date.parse(rows1[0].last_updated) / 1000;
            params.to_id = rows1[0].to_id;
            params.from_id = rows1[0].from_id;

            params.forUnconfirmedDeals1 = forUnconfirmedDeals1;
            params.forUnconfirmedDeals2 = forUnconfirmedDeals2;

            // transferToAssetId
            acceptTransferPartner2Asset(params, function (status, error_info) {
                cb(status, error_info);
            });

        } else {
            actionType = "unknownType";
            console.log( colors.red("worker.acceptTransfer.error: actionType = unknownType") );
        }
    });
}

/**
 *Подтверждение перевода партнер->партнер
 * @param params
 * params.newAssetSaldo
 * params.newPartnerSaldo
 * params.hash
 * params.newHash
 * params.transferAssetId
 */
function acceptTransferPartner2Partner(params, cb) {

    //проверяем - есть ли более ранние не подтвержденные сделки.
    // если есть - не позволяем выполнить текущую операцию
    //INFO: данный блок кода вызывал не верную блокировку
/*    var q1 = "SELECT last_updated FROM actions WHERE last_updated < FROM_UNIXTIME("+params.last_updated+") AND " +
        "status='PENDING' AND to_id="+params.to_id+" AND from_id="+params.from_id+" " +
        "AND (action_type='SEND_OUTGOING_PAYMENT_REQUEST' OR action_type='SEND_INCOMING_PAYMENT_REQUEST')";*/



    var q1 = "SELECT last_updated FROM actions WHERE last_updated < FROM_UNIXTIME("+params.last_updated+") AND " +
     "status='PENDING' AND to_id="+params.to_id+" AND from_id="+params.from_id+" " +
     "AND (action_type='GET_OUTGOING_PAYMENT_REQUEST' OR action_type='GET_INCOMING_PAYMENT_REQUEST')";



    mysqlPoolSelectQuery(q1, function (rows1) {
        //для запросов на запись подтвержденных транзакций
        var q5 = "";

        if(rows1.length > 0) {
            console.error("acceptTransferPartner2Partner.processing_erly_actions_before",q1, rows1, params);
            cb("error", "processing_erly_actions_before");//Обработайте сперва более ранние транзакции
            return false;
        }

        if (params.userActionType == 'GET_INCOMING_PAYMENT_REQUEST') {

            var q2 = "UPDATE actions SET status=CASE " +
                "WHEN asset_type='partner' THEN 'ACCEPT' "+ //устанавливаем значение ACCEPT для активов-партнеров
                "ELSE status END, " +
                "hash = CASE " +
                "WHEN hash='"+params.hash+"' THEN '"+params.newHash+"' " +
                "ELSE hash END, " +
                "to_id = CASE " +
                "WHEN to_id=-1 THEN "+params.transferToAssetId+" " +
                "ELSE to_id END, "+
                "from_id = CASE " +
                "WHEN from_id=-1 THEN "+params.transferToAssetId+" " +
                "ELSE from_id END "+
                "WHERE hash='"+params.hash+"' AND user_id<>"+params.user_id;

            mysqlPoolQuery(q2, function (rows2) {

                var q3 = "UPDATE assets SET saldo=CASE " +
                    //зачисляем/списываем с актива-партнера,
                    //у юзера, отправляющего подтверждение
                    //зачисляем на актив получателя(или
                    //списываем с актива отправителя, получившегго запрос на списание)
                    "WHEN id=" + params.transferPartnerFromId + " THEN saldo-" + params.transferToPartner + " " +
                    "WHEN id=" + params.transferToAssetId + " THEN saldo+" + params.transferToPartner + " " +
                    "ELSE saldo END, " +

                    "unconfirmed_incoming_deals=CASE " +
                    "WHEN id=" + params.transferPartnerFromId + " THEN unconfirmed_incoming_deals-1 " +//TODO
                    " ELSE unconfirmed_incoming_deals END, " +

                    "unconfirmed_outgoing_deals=CASE " +
                    "WHEN id=" + params.to_id + " THEN unconfirmed_outgoing_deals-1 " +//TODO
                    " ELSE unconfirmed_outgoing_deals END " +

                    "WHERE id IN(" + params.transferToAssetId + "," + params.transferPartnerFromId + ", " +
                    params.to_id + ")";

                mysqlPoolQuery(q3, function (status) {

                    //получаем комментарий, указанный юзером-инициализатором перевода
                    var q4 = "SELECT comment FROM actions WHERE hash='" + params.newHash + "' " +
                        "AND action_type='GET_INCOMING_PAYMENT_REQUEST' LIMIT 1";
                    mysqlPoolSelectQuery(q4, function (rows4) {

                        var comment = rows4.length != 0 ? rows4[0].comment : "";

                        //добавляем запись для "актива транзакции"(списание или получение)
                        q5 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, from_id, to_id, " +
                            "payment_sum, status," +
                            " hash, comment) " +
                            "VALUES(" + params.user_id + ", " + params.transferToAssetId + ", " +
                            "'GET_PAYMENT', 'asset', " +
                            params.transferPartnerFromId + ", " + params.transferToAssetId + ", " +
                            params.transferToAsset + ", " + "'OK', '" + params.newHash + "', '" + comment + "')";


                        mysqlPoolQuery(q5, function (status5) {
                            //отправка push-уведомлений пользователю-получателю
                            console.log("acceptTransferPartner2Partner(1)", params.transferPartnerFromId);
                            
                            partnerId2pushToken(params.to_id,
                                function (replyPushToken) {
                                    console.log("acceptTransferPartner2Partner", replyPushToken);
                                    if (replyPushToken == 0) {
                                        //ошибка
                                        console.log("error.acceptTransferPartner2Partner", 
                                            params.transferPartnerFromId, replyPushToken);
                                    } else {
                                        //все ок
                                        var jData = {};
                                        jData.pushToken = replyPushToken;
                                        jData.assetId = params.to_id;
                                        jData.msgType = "push";
                                        jData.message = "Сделка подтверждена";

                                        isOnline(params.to_id, function (onlineResult) {
                                            if(onlineResult) {
                                                //online
                                                jData.socketId = onlineResult;
                                                sendWsMessageTaskToQueue(jData);
                                            } else {
                                                //offline
                                                sendSmsTaskToQueue(jData);
                                            }
                                        });
                                }
                            });
                            
                            
                            cb(status5);
                        });

                    });
                });
            });

        } else if (params.userActionType == 'GET_OUTGOING_PAYMENT_REQUEST') {

            var q5_1 = "SELECT id FROM assets WHERE asset_id_in_partner=" + params.from_id;

            mysqlPoolSelectQuery(q5_1, function (rows_5_1) {

                if (rows_5_1.length == 0) {
                    cb("error");
                }

                var userAssetFromId = rows_5_1[0].id;

            var q2 = "UPDATE actions SET status=CASE " +
                "WHEN asset_type='partner' THEN 'ACCEPT' "+ //устанавливаем значение ACCEPT для активов-партнеров
                "ELSE status END, " +
                "hash = CASE " +
                "WHEN hash='"+params.hash+"' THEN '"+params.newHash+"' " +
                "ELSE hash END, " +
                "to_id = CASE " +
                "WHEN to_id=-1 THEN "+params.transferToAssetId+" " +
                "ELSE to_id END, "+
                "from_id = CASE " +
                "WHEN from_id=-1 THEN "+params.transferToAssetId+" " +
                "ELSE from_id END "+
                "WHERE hash='"+params.hash+"' AND user_id<>"+params.user_id;

            mysqlPoolQuery(q2, function (rows2) {

                    var q3 = "UPDATE assets SET saldo=CASE " +
                        //зачисляем/списываем с актива-партнера,
                        //у юзера, отправляющего подтверждение
                        "WHEN id=" + params.transferToAssetId + " THEN saldo-" + params.transferToPartner + " " +
                        //зачисляем на актив получателя(или
                        //списываем с актива отправителя, получившегго запрос на списание)
                        "WHEN id=" + userAssetFromId + " THEN saldo+" + params.transferToPartner + " " +
                        "ELSE saldo END, " +

                        "unconfirmed_outgoing_deals=CASE " +
                        "WHEN id=" + params.from_id + " THEN unconfirmed_outgoing_deals-1 " +//TODO: проверить
                        " ELSE unconfirmed_outgoing_deals END, " +

                        "unconfirmed_incoming_deals=CASE " +
                        "WHEN id=" + userAssetFromId + " THEN unconfirmed_incoming_deals-1 " +//TODO: проверить
                        "ELSE unconfirmed_incoming_deals END " +

                        "WHERE id IN(" + params.transferToAssetId + "," + params.from_id + ", " + userAssetFromId + ")";


                    mysqlPoolQuery(q3, function (status) {

                        //получаем комментарий, указанный юзером-инициализатором перевода
                        var q4 = "SELECT comment FROM actions WHERE hash='" + params.newHash + "' " +
                            "AND action_type='GET_OUTGOING_PAYMENT_REQUEST' LIMIT 1";
                        mysqlPoolSelectQuery(q4, function (rows4) {

                            var comment = rows4.length != 0 ? rows4[0].comment : "";

                            q5 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, from_id, to_id, " +
                                "payment_sum, status," +
                                " hash, comment) " +
                                "VALUES(" + params.user_id + ", " + params.transferToAssetId + ", 'SEND_PAYMENT', " +
                                "'asset', " +
                                params.transferToAssetId + ", " + userAssetFromId + ", " +
                                params.transferToAsset + ", " + "'OK', '" + params.newHash + "', '" + comment + "')";

                            mysqlPoolQuery(q5, function (status5) {

                                //отправка push-уведомлений пользователю-получателю
                                console.log("acceptTransferPartner2Partner(2)", params.transferToAssetId,
                                    params.from_id, userAssetFromId);
                                
                                partnerId2pushToken( params.to_id,
                                    function (replyPushToken) {
                                        console.log("acceptTransferPartner2Partner", replyPushToken);
                                        if (replyPushToken == 0) {
                                            //ошибка
                                            console.log("error.acceptTransferPartner2Partner", 
                                                userAssetFromId,
                                                replyPushToken);
                                        } else {
                                            //все ок
                                            var jData = {};
                                            jData.pushToken = replyPushToken;
                                            jData.assetId = params.to_id;
                                            jData.msgType = "push";
                                            jData.message = "Сделка подтверждена";

                                            isOnline(params.to_id, function (onlineResult) {
                                                if(onlineResult) {
                                                    //online
                                                    jData.socketId = onlineResult;
                                                    sendWsMessageTaskToQueue(jData);
                                                } else {
                                                    //offline
                                                    sendSmsTaskToQueue(jData);
                                                }
                                            });
                                        }
                                });
                                
                                //


                                cb(status5);
                            });

                        });
                    });
                });
            });
        }
    });
}


/**
 *Подтверждение перевода актив->партнер
 * @param params
 * params.newAssetSaldo
 * params.newPartnerSaldo
 * params.hash
 * params.newHash
 * params.transferAssetId
 */
function acceptTransferAsset2Partner(params, cb) {

    //проверяем - есть ли более ранние не подтвержденные сделки. если есть - не позволяем выполнить текущую операцию
    var q1 = "SELECT last_updated FROM actions WHERE last_updated < FROM_UNIXTIME("+params.last_updated+") AND " +
        "status='PENDING' AND to_id="+params.to_id+" AND from_id="+params.from_id+" " +
        "AND (action_type='SEND_OUTGOING_PAYMENT_REQUEST' OR action_type='SEND_INCOMING_PAYMENT_REQUEST')";

    mysqlPoolSelectQuery(q1, function (rows1) {

        if(rows1.length > 0) {
            cb("error", "processing_erly_actions_before");//Обработайте сперва более ранние транзакции
            return false;
        }

        var q2 = "UPDATE actions SET status=CASE " +
            "WHEN asset_type='partner' THEN 'ACCEPT' "+ //устанавливаем значение ACCEPT для активов-партнеров
            "WHEN asset_type='asset' THEN 'OK' "+ //устанавливаем значение OK для актива списания
            "ELSE status END, " +
            "hash = CASE " +
            "WHEN hash='"+params.hash+"' THEN '"+params.newHash+"' " +
            "ELSE hash END, " +
            "to_id = CASE " +
            "WHEN to_id=-1 THEN "+params.transferToAssetId+" " +//TODO: проветить здесь правильность нуля
            "ELSE to_id END "+
            "WHERE hash='"+params.hash+"' AND user_id<>"+params.user_id;


        mysqlPoolQuery(q2, function (rows2) {

            var q3 = "UPDATE assets SET saldo=CASE " +
                //зачисляем/списываем с актива-партнера,
                //у юзера, отправляющего подтверждение
                "WHEN id=" + params.transferToAssetId + " THEN " + params.newAssetSaldo + " " +
                //зачисляем на актив получателя(или
                //списываем с актива отправителя, получившегго запрос на списание)
                "WHEN id=" + params.transferPartnerFromId + " THEN " + params.newPartnerSaldo + " " +
                "ELSE saldo END, " +

                "unconfirmed_outgoing_deals=CASE "+
                "WHEN id=" + params.transferToPartnerId + " THEN unconfirmed_outgoing_deals-1 " +
                " ELSE unconfirmed_outgoing_deals END, " +

                "unconfirmed_incoming_deals=CASE "+
                "WHEN id=" + params.transferPartnerFromId + " THEN unconfirmed_incoming_deals-1 " +
                " ELSE unconfirmed_incoming_deals END " +

                "WHERE id IN(" + params.transferToAssetId + "," + params.transferPartnerFromId + ", " +
                params.transferToPartnerId+")";

            mysqlPoolQuery(q3, function (status) {

                //получаем комментарий, указанный юзером-инициализатором перевода
                var q4 = "SELECT comment FROM actions WHERE hash='"+params.newHash+"' " +
                    "AND action_type='GET_INCOMING_PAYMENT_REQUEST' LIMIT 1";
                mysqlPoolSelectQuery(q4, function (rows4) {

                    var comment = rows4.length != 0 ? rows4[0].comment : "";

                    //добавляем запись для "актива транзакции"(списание или получение)
                    var q5 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, from_id, to_id, " +
                        "payment_sum, status," +
                        " hash, comment) " +
                        "VALUES("+params.user_id+", "+params.transferToAssetId+", 'GET_PAYMENT', 'asset', "+
                        params.transferPartnerFromId+", "+params.transferToAssetId+", " +params.transferToAsset+", " +
                        "'OK', '"+ params.newHash+"', '"+comment+"')";

                    mysqlPoolQuery(q5, function (status5) {

                        //отправка push-уведомлений пользователю-получателю
                        partnerId2pushToken( params.transferToPartnerId,
                            function (replyPushToken) {

                                if(replyPushToken == 0) {
                                    //ошибка
                                    console.log("error.acceptTransferAsset2Partner", params.transferPartnerFromId,
                                    replyPushToken);
                                } else {
                                    //все ок
                                    var jData = {};
                                    jData.pushToken = replyPushToken;
                                    jData.assetId = params.transferToPartnerId;
                                    jData.msgType = "push";
                                    jData.message = "Сделка подтверждена";

                                    isOnline(params.transferToPartnerId, function (onlineResult) {
                                        if(onlineResult) {
                                            //online
                                            jData.socketId = onlineResult;
                                            sendWsMessageTaskToQueue(jData);
                                        } else {
                                            //offline
                                            sendSmsTaskToQueue(jData);
                                        }
                                    });
                                }
                            });
                        
                        cb(status5);
                    });

                });
            });
        });

    });
}

/**
 *Подтверждение перевода партнер->актив
 * @param params
 * params.newAssetSaldo
 * params.newPartnerSaldo
 * params.hash
 * params.newHash
 * params.transferToAssetId
 */
function acceptTransferPartner2Asset(params, cb) {

    //проверяем - есть ли более ранние не подтвержденные сделки.
    //если есть - не позволяем выполнить текущую операцию
    var q0 = "SELECT last_updated FROM actions WHERE last_updated < FROM_UNIXTIME("+params.last_updated+") AND " +
        "status='PENDING' AND to_id="+params.to_id+" AND from_id="+params.from_id+" " +
        "AND (action_type='SEND_OUTGOING_PAYMENT_REQUEST' OR action_type='SEND_INCOMING_PAYMENT_REQUEST')";

    mysqlPoolSelectQuery(q0, function(rows0) {

        if (rows0.length > 0) {
            cb("error", "processing_erly_actions_before");//Обработайте сперва более ранние транзакции
            return false;
        }

        //1. получаем сумму, которую 1-ый юзер предлагает 2-му юзеру списать в пользу 1-го юзера
        var q1 = "SELECT to_id, payment_sum, comment FROM actions " +
            "WHERE action_type='GET_OUTGOING_PAYMENT_REQUEST' AND " +
            "hash='" + params.hash + "' LIMIT 1";

        mysqlPoolSelectQuery(q1, function (rows1) {

            //сумма, которую 1-й юзер предлагает списать 2-му юзеру в пользу 1-го
            var transferSum = rows1[0].payment_sum;
            var transferComment = rows1[0].comment;//комментарий к переводу

            //с какого актива(актива-партнера)
            // 2-го юзера был получен данный перевод
            var transferToPartnerId = rows1[0].to_id;


            var q2 = "UPDATE actions SET status=CASE " +
                "WHEN asset_type='partner' THEN 'ACCEPT' " + //устанавливаем значение ACCEPT для активов-партнеров
                "WHEN asset_type='asset' THEN 'OK' " + //устанавливаем значение OK для актива списания
                "ELSE status END, " +
                "hash = CASE " +
                "WHEN hash='" + params.hash + "' THEN '" + params.newHash + "'" +
                "ELSE '" + params.newHash + "' END, " +
                "from_id = CASE " +
                "WHEN from_id=-1 THEN " + params.transferToAssetId + " " +
                "ELSE from_id END " +
                "WHERE hash='" + params.hash + "' AND user_id<>" + params.user_id;

            //добавляем 4-ю запись в таблицу actions
            mysqlPoolQuery(q2, function (status2) {

                var q3 = "INSERT INTO actions(asset_id, action_type, asset_type, from_id, to_id, payment_sum, " +
                    "status, hash, comment) VALUES(" + params.transferToAssetId + ", 'SEND_PAYMENT', 'asset', " +
                    params.transferToAssetId + ", " + transferToPartnerId + ", " + transferSum + ", 'OK', " +
                    "'" + params.newHash + "', '" + transferComment + "')";

                //далее, здесь обновляем сальдо у 2-го юзера
                // (юзера, который получил и подтвердил запрос на списание
                // со своего счета средств в пользу 1-го юзера)

                mysqlPoolQuery(q3, function (status3) {

                    var q4 = "UPDATE assets SET saldo=CASE " +
                        "WHEN id=" + params.transferToAssetId + " THEN saldo-" + transferSum + " " +
                        "WHEN id=" + transferToPartnerId + " THEN saldo+" + transferSum + " " +
                        "ELSE saldo END, " +

                        "unconfirmed_incoming_deals=CASE "+
                        "WHEN id=" + transferToPartnerId + " THEN unconfirmed_incoming_deals-1 " +
                        " ELSE unconfirmed_incoming_deals END, " +

                        "unconfirmed_outgoing_deals=CASE "+
                        "WHEN id=" + params.forUnconfirmedDeals1 + " THEN unconfirmed_outgoing_deals-1 " +
                        " ELSE unconfirmed_outgoing_deals END " +

                        "WHERE id IN(" + params.transferToAssetId + ", " + transferToPartnerId + ", " +
                        params.forUnconfirmedDeals1 + ", " +
                        params.forUnconfirmedDeals2 + ")";


                    mysqlPoolQuery(q4, function (status4) {

                        //отправка push-уведомлений пользователю-получателю
                        partnerId2pushToken(
                            params.forUnconfirmedDeals1, function (replyPushToken) {

                                if (replyPushToken == 0) {
                                    //ошибка
                                    console.log("error.acceptTransferPartner2Asset", transferToPartnerId,
                                    replyPushToken);
                                } else {
                                    //все ок
                                    var jData = {};
                                    jData.pushToken = replyPushToken;
                                    jData.assetId = params.forUnconfirmedDeals1;
                                    jData.msgType = "push";
                                    jData.message = "Сделка подтверждена";

                                    isOnline(params.forUnconfirmedDeals1, function (onlineResult) {
                                        if(onlineResult) {
                                            //online
                                            jData.socketId = onlineResult;
                                            sendWsMessageTaskToQueue(jData);
                                        } else {
                                            //offline
                                            sendSmsTaskToQueue(jData);
                                        }
                                    });
                            }
                        });

                        cb(status4);
                    });
                });

            });
        });

    });

}



/**********************SALDO ZONE****************************/
function setSaldo(jsonData, cb) {

    var q = "SELECT asset_id_in_partner, type FROM assets WHERE id="+jsonData.assetId+"" +
        " AND user_id="+jsonData.user_id+" LIMIT 1";
    mysqlPoolSelectQuery(q, function(rows) {
        console.log("setSaldo.select.rows", rows);
        if(rows == "error") {
            //ошибка запроса, в синтаксисе
            console.error("setSaldo.error.syntax");
            cb("error");
        } else if(rows.length == 0) {
            //не найден указанный актив
            console.error("setSaldo.error.not found asset");
            cb("error");
        } else {
            //все ок
            jsonData.partnerAssetId = rows[0].asset_id_in_partner;
            //определяем - задаем сальдо активу или партнеру
            if(rows[0].type =="asset") {
                setAssetSaldo(jsonData, function (result) {
                    cb(result);
                });
            } else if(rows[0].type =="partner") {
                setPartnerSaldo(jsonData, function (result, errorInfo) {
                    cb(result, errorInfo);
                });
            }
        }

    });
}

function setAssetSaldo(jsonData, cb) {

    var q1 = "UPDATE assets SET saldo="+jsonData.newSaldo +
        " WHERE id="+jsonData.assetId+" AND user_id="+jsonData.user_id;

    mysqlPoolSelectQuery(q1, function(rows1, err1) {

        if(err1) {
            cb("error");
            return false;
        }

        var q2 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, status, from_id, to_id, " +
            "payment_sum, comment) " +
            "VALUES("+jsonData.user_id+", "+ jsonData.assetId+", 'SET_SALDO', 'asset', 'OK', "+jsonData.assetId+", "+
            jsonData.assetId+", "+jsonData.newSaldo+", 'Вы установили новое сальдо')";
        mysqlPoolSelectQuery(q2, function(rows2, err2) {
            cb("ok");
        });

    });

}

function setPartnerSaldo(jsonData, cb) {

    //начало mysql-транзакции
    var q = "SELECT id, saldo, asset_id_in_partner FROM assets WHERE id IN("+jsonData.assetId+", "+
        jsonData.partnerAssetId+") LIMIT 2";

        mysqlPoolSelectQuery(q, function(rows, err) {
            console.log("setPartnerSaldo.select", err, rows);
        if(err) {
            console.error(err);
            cb("error");
            return false;
        } else if(rows.length < 2) {
            console.error("setPartnerSaldo.length < 2");
            cb("error");
            return false;
        }

        var senderSaldo = rows[0].id == jsonData.assetId ? rows[0].saldo : rows[1].saldo;
        var receiverSaldo = rows[0].id == jsonData.partnerAssetId ? rows[0].saldo : rows[1].saldo;

        var assetIdInPartner = rows[1].asset_id_in_partner != null ? rows[1].asset_id_in_partner : false;

        //проверяем - нет ли в "принимающем" активе еще не обработанных отправленных событий
        var q0 = "SELECT unconfirmed_outgoing_deals FROM assets WHERE id=" +
            jsonData.partnerAssetId+" "+
            "AND unconfirmed_outgoing_deals>0";//тут так же можно добавить проверку наличия входящих не завершенных
            //сделок у отправителя

        mysqlPoolSelectQuery(q0, function(statusOrRows, err0) {

            if(err0 || statusOrRows == "error") {
                console.error(err0, statusOrRows, q0);
                cb("error");//, statusOrRows.code);
                return false;
            }
            if(statusOrRows.length > 0) {
                console.error("error.statusOrRows.length: ", statusOrRows, q0);
                cb("error", "processing_incoming_actions_before");
                return false;
            }

            //вносим изменения в записи активов
            var q1 = "UPDATE assets SET saldo=CASE " +
                "WHEN id=" + jsonData.assetId + " THEN " + jsonData.newSaldo +
                " ELSE saldo END, " +

                "unconfirmed_outgoing_deals=CASE " +
                "WHEN id="+jsonData.assetId+" THEN unconfirmed_outgoing_deals+1 " +
                "ELSE unconfirmed_outgoing_deals END, " +

                "unconfirmed_incoming_deals=CASE " +
                "WHEN id="+jsonData.partnerAssetId+" THEN unconfirmed_incoming_deals+1 " +
                "ELSE unconfirmed_incoming_deals END, " +

                //делаем партнера видимым, если он вдруг был удален
                "is_visible=1 " +

                "WHERE id IN (" + jsonData.assetId + ", "+jsonData.partnerAssetId+")";

            mysqlPoolSelectQuery(q1, function(rows1, err1) {
                if(err1) {
                    console.error(err1);
                    cb("error", err1.code);
                    return false;
                }

                var actionHash = sha1(new Date().getTime());

                var q2 = "INSERT INTO actions(user_id, asset_id, action_type, asset_type, status, payment_sum, " +
                    "from_id, to_id, hash, comment, old_saldo) " +
                    "VALUES("+jsonData.user_id+", "+ jsonData.assetId+", 'SEND_SET_SALDO_REQUEST', 'partner', " +
                    "'PENDING', "+jsonData.newSaldo+", "+jsonData.assetId+", "+jsonData.partnerAssetId+
                    ",'"+actionHash+"', 'Вы предложили сальдо', "+senderSaldo+"), " +
                    "("+jsonData.user_id+", "+ jsonData.partnerAssetId+", 'GET_SET_SALDO_REQUEST', 'partner', " +
                    "'PENDING', "+-jsonData.newSaldo+", "+
                    jsonData.partnerAssetId+", "+jsonData.assetId+
                    ",'"+actionHash+"', 'Вам предложено сальдо', "+receiverSaldo+")";

                mysqlPoolSelectQuery(q2, function(rows2, err2) {
                    console.log("setPartnerSaldo,q2",rows2);
                    if(err2) {
                        console.error(err2);
                    }

                    console.log("paetnerSaldo=", jsonData.partnerAssetId, assetIdInPartner);
                    partnerId2pushToken(jsonData.partnerAssetId, function(pushToken) {
                        //все ок
                        var jData = {};
                        jData.pushToken = pushToken;
                        jData.msgType = "push";
                        jData.message = "Предложение нового сальдо";

                        isOnline(jsonData.partnerAssetId, function (onlineResult) {
                            jData.assetId = jsonData.partnerAssetId;
                            if(onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                sendSmsTaskToQueue(jData);
                            }
                        });
                        cb("ok");
                    });
                });
            });

        });
    });
}

function acceptNewSaldo(jsonData, cb) {

    var q1 = "SELECT asset_id, from_id, to_id, action_type, payment_sum FROM actions " +
        "WHERE hash='"+jsonData.actionHash+"'";

    mysqlPoolSelectQuery(q1, function(rows1, err1) {

        if(err1) {
            cb("error", err1.code);
            return false;
        }
        else if(rows1.length == 0) {
            //ошибка, не найдена запись
            cb("error", "action_not_found");
            return false;
        }

        else if(rows1.length < 2) {
            //ошибка, не найдена запись
            cb("error", "action_not_found");
            return false;
        }


        //сальдо у получателя. у отправителя оно будет с противоположным знаком
        var assetIdForSetNewSaldo = rows1[0].action_type == 'GET_SET_SALDO_REQUEST' ? rows1[0].from_id :
            rows1[1].action_type == 'GET_SET_SALDO_REQUEST' ? rows1[1].from_id : -1;

        var assetIdForSetUnconfirmedDeals = rows1[0].action_type == 'SEND_SET_SALDO_REQUEST' ? rows1[0].from_id :
            rows1[1].action_type == 'SEND_SET_SALDO_REQUEST' ? rows1[1].from_id : -1;

        var newSaldoForReceiver = rows1[0].action_type == 'GET_SET_SALDO_REQUEST' ? rows1[0].payment_sum :
            rows1[1].action_type == 'GET_SET_SALDO_REQUEST' ? rows1[1].payment_sum : "***";

        if(assetIdForSetNewSaldo == -1 || assetIdForSetUnconfirmedDeals == -1 || newSaldoForReceiver == "***") {
            //ошибка, не найден актив-партнер получателя нового сальдо
            cb("error", "partner_not_found");
            return false;
        }

        var actionHash = sha1(new Date().getTime());

        var q2 = "UPDATE actions SET status='ACCEPT', hash='"+actionHash+"' WHERE hash='"+jsonData.actionHash+"' " +
            "AND user_id<>"+jsonData.user_id;

        mysqlPoolSelectQuery(q2, function(rows2, err2) {

            if(err2) {
                cb("error", err2.code);
            }

            var q3 = "UPDATE assets SET saldo=CASE " +
                "WHEN id="+assetIdForSetNewSaldo+" THEN "+newSaldoForReceiver+
                " WHEN id="+assetIdForSetUnconfirmedDeals+" THEN "+-newSaldoForReceiver+
                " ELSE saldo END, "+

                "unconfirmed_incoming_deals=CASE " +
                "WHEN id="+assetIdForSetNewSaldo+" THEN unconfirmed_incoming_deals-1 " +
                "ELSE unconfirmed_incoming_deals END, " +

                "unconfirmed_outgoing_deals=CASE " +
                "WHEN id="+assetIdForSetUnconfirmedDeals+" THEN unconfirmed_outgoing_deals-1 " +
                "ELSE unconfirmed_outgoing_deals END " +

                "WHERE id IN (" + assetIdForSetNewSaldo + ", "+assetIdForSetUnconfirmedDeals+")";

            mysqlPoolQuery(q3, function(status3) {

                partnerId2pushToken( assetIdForSetUnconfirmedDeals, function (replyPushToken) {
                    if (replyPushToken == 0) {
                        //ошибка
                        console.log("error.acceptNewSaldo", assetIdForSetUnconfirmedDeals, replyPushToken);
                    } else {

                        //все ок
                        var jData = {};
                        jData.pushToken = replyPushToken;
                        jData.msgType = "push";
                        jData.message = "Партнер принял новое сальдо";

                        isOnline(assetIdForSetUnconfirmedDeals, function (onlineResult) {
                            jData.assetId = assetIdForSetUnconfirmedDeals;
                            if(onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                sendSmsTaskToQueue(jData);
                            }
                        });
                        // cb("ok");
                    }
                });

                cb("ok");

            });
        });
    });

}

function declineNewSaldo(jsonData, cb) {

    //TODO: возможно здесь баг, т.к. не предсказуем порядок выдачи активов
    var q1 = "SELECT asset_id, old_saldo FROM actions " +
        "WHERE hash='"+jsonData.actionHash+"' AND user_id<>"+jsonData.user_id+" LIMIT 2";

    mysqlPoolSelectQuery(q1, function(rows1, err1) {

        if(err1) {
            cb("error", err1.code);
            return false;
        }
        else if(rows1.length < 2) {
            //ошибка, не найдена запись
            cb("error", "action_not_found");
            return false;
        }

        var assetId1 = rows1[0].asset_id || -1;
        var assetId2 = rows1[1].asset_id || -1;

        var saldo1 = rows1[0].old_saldo;// || "***";
        var saldo2 = rows1[1].old_saldo;// || "***";

        if(saldo1 == null || saldo1 == undefined) saldo1 = "***";
        if(saldo2 == null || saldo2 == undefined) saldo2 = "***";

        if(assetId1 == -1 || assetId2 == -1
        || saldo1 == "***" || saldo2 == "***") {
            //ошибка, не найден актив-партнер получателя нового сальдо
            cb("error", "partner_not_found");
            return false;
        }

        var actionHash = sha1(new Date().getTime());
        var q2 = "UPDATE actions SET status='DECLINE', hash='"+actionHash+"' WHERE hash='"+jsonData.actionHash+"' " +
            "AND user_id<>"+jsonData.user_id;

        mysqlPoolSelectQuery(q2, function(rows2, err2) {

            if(err2) {
                cb("error", err2.code);
            }

            var q3 = "UPDATE assets SET saldo=CASE " +
                "WHEN id="+assetId1+" THEN "+saldo1+
                " WHEN id="+assetId2+" THEN "+saldo2+
                " ELSE saldo END, "+

                "unconfirmed_outgoing_deals=CASE " +
                "WHEN id="+assetId1+" THEN unconfirmed_outgoing_deals-1 " +
                "ELSE unconfirmed_outgoing_deals END, " +

                "unconfirmed_incoming_deals=CASE " +
                "WHEN id="+assetId2+" THEN unconfirmed_incoming_deals-1 " +
                "ELSE unconfirmed_incoming_deals END, " +

                "was_declined=CASE " +
                "WHEN id="+assetId1+" THEN 1 " +
                "ELSE was_declined END " +

                "WHERE id IN (" + assetId1 + ", "+assetId2+")";

            mysqlPoolQuery(q3, function(status3) {

                partnerId2pushToken( assetId1, function (replyPushToken) {
                    if (replyPushToken == 0) {
                        //ошибка
                        console.log("declineNewSaldo", assetId2, replyPushToken);
                    } else {

                        //все ок
                        var jData = {};
                        jData.pushToken = replyPushToken;
                        jData.msgType = "push";
                        jData.message = "Партнер отказался от нового сальдо";

                        isOnline(assetId1, function (onlineResult) {
                            jData.assetId = assetId1;
                            if(onlineResult) {
                                //online
                                jData.socketId = onlineResult;
                                sendWsMessageTaskToQueue(jData);
                            } else {
                                //offline
                                sendSmsTaskToQueue(jData);
                            }
                        });

                    }
                });
                
                
                
                cb("ok");
            });
        });
    });
}
/******************END SALDO ZONE****************************/


/**
 * повторная отправка сообщения в очередь.
 * в случае, когда нужно вызвать другой action в воркере, без отправки ответа на сервер и затем на клиент и без
 * повтора всего маршрута клиент->сервер->воркер
 */
function sendSmsTaskToQueue(jsonData) {

    console.log("sendSmsTaskToQueue", jsonData);

    var jsonDataString = JSON.stringify(jsonData);
    rabbit.then(function(connection) {
        var ok = connection.createChannel();
        ok.then(function(channel) {
            // durable: true is set by default
            channel.assertQueue("sms");//messages
            channel.assertExchange("sms_exchange");//incoming
            channel.bindQueue("sms", "sms_exchange", "mda");
            channel.publish("sms_exchange", "mda", new Buffer(jsonDataString), {deliveryMode: false});
            return ok;
        }).
        then(null, console.log);
        return ok;
    }).
    then(null, console.log);
}

function sendWsMessageTaskToQueue(jsonData) {
    var jsonDataString = JSON.stringify(jsonData);
    rabbit.then(function(connection) {
        var ok = connection.createChannel();
        ok.then(function(channel) {
            // durable: true is set by default
            channel.assertQueue("ws");//messages
            channel.assertExchange("ws_exchange");//incoming
            channel.bindQueue("ws", "ws_exchange", "mda");
            channel.publish("ws_exchange", "mda", new Buffer(jsonDataString), {deliveryMode: false});
            return ok;
        }).
        then(null, console.log);
        return ok;
    }).
    then(null, console.log);
}


function sendToChatQueue(jsonData) {

    //INFO: отключаем функцию, т.к. джаббер-чат не используется
    return false;

    console.log("sendToChatQueue", jsonData);

    var jsonDataString = JSON.stringify(jsonData);
    rabbit.then(function(connection) {

        var ok = connection.createChannel();
        ok.then(function(channel) {
            // durable: true is set by default
            channel.assertQueue("chatMessages");//messages
            channel.assertExchange("chat_exchange");//incoming
            channel.bindQueue("chatMessages", "chat_exchange", "mda");
            channel.publish("chat_exchange", "mda", new Buffer(jsonDataString), {deliveryMode: false});
            return ok;
        }).
        then(null, console.log);
        return ok;
    }).
    then(null, console.log);
}


/**
 *
 * @param partnerId id партнера, которому отправляем транзакцию или сообщение чата
 * @param cb функция обратного вызова
 */
function isOnline(partnerId, cb) {

    cb(false);

    /*redisClient.hget("partnersUsers", partnerId, function (err1, userId) {
        if(err1 || !userId) {
            cb(false);
            return false;
        }
        
        redisClient.hget("online", userId, function(err2, socketId) {
            if(err2 || !socketId) {
                cb(false);
                return false;
            }
            cb(socketId);
        });
    });*/

}


/*function updateBadges(partnerId) {
    var q1 = "UPDATE assets SET " +
     "unconfirmed_incoming_deals=" +
     "(SELECT COUNT(*) FROM actions WHERE asset_id="+partnerId+" AND status='PENDING' AND " +
     "(action_type='GET_INCOMING_PAYMENT_REQUEST' OR action_type='GET_OUTGOING_PAYMENT_REQUEST') ), " +
     "unconfirmed_outgoing_deals=" +
     "(SELECT COUNT(*) FROM actions WHERE asset_id="+partnerId+" AND status='PENDING' AND " +
     "(action_type='SEND_INCOMING_PAYMENT_REQUEST' OR action_type='SEND_OUTGOING_PAYMENT_REQUEST') ) " +
     "WHERE id="+partnerId;
}*/

function updateBadges() {

    var q1 = "UPDATE assets aa SET unconfirmed_incoming_deals=(SELECT COUNT(*) FROM actions " +
        "WHERE asset_id=aa.id AND status='PENDING' AND(action_type='GET_INCOMING_PAYMENT_REQUEST' " +
        "OR action_type='GET_OUTGOING_PAYMENT_REQUEST') )," +
        "unconfirmed_outgoing_deals=(SELECT COUNT(*) FROM actions WHERE asset_id=aa.id AND status='PENDING' " +
        "AND (action_type='SEND_INCOMING_PAYMENT_REQUEST' OR action_type='SEND_OUTGOING_PAYMENT_REQUEST') )";

    mysqlPoolQuery(q1, function(status1) {
        console.log("bages was updated");
    });
}

function getIconBagesByUserId(userId, cb) {

    var q1 = "SELECT COUNT(id) as bagesCount FROM actions WHERE asset_id="+userId+" AND status='PENDING' AND " +
        "action_type LIKE 'GET_%' AND action_type!='GET_PAYMENT'";
    mysqlPoolSelectQuery(q1, function(rows1) {
        if(rows1.length > 0) {
            console.log("bages count=", rows1[0].bagesCount);
            cb(rows1[0].bagesCount);
        } else {
            cb(0);
        }
    });
}


function partnerId2pushToken(partnerId, cb) {
    console.log("dbWorker.partnerId2pushToken", partnerId);
    mysqlPoolSelectQuery(
        'SELECT u.pushToken as pushToken FROM users as u JOIN assets as a ON u.id=a.user_id ' +
        'WHERE a.id='+partnerId,
         function (rows) {
            if (rows == "error") {
                console.log('database error: ', rows);
            } else {
                if(rows.length == 0){cb(0);}
                else {
                    //ok
                    cb(rows[0].pushToken);
                }
            }
        });
}

