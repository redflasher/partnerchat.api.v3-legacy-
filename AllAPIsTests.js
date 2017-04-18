require('dotenv').config();

var mysql      = require('mysql');
var pool  = mysql.createPool({
    connectionLimit : 10,
    host     : process.env.DB_HOST,
    user     : process.env.DB_USER,
    password : process.env.DB_PASS,
    database : process.env.DB_DATABASE
});

var colors = require('colors/safe');

var apn = require('apn');

var gcm = require('node-gcm');

require( "console-stamp" )( console, { pattern : "dd/mm/yyyy HH:MM:ss.l" } );

var _token;

var count = 0;

var userParams = (process.argv[2] && process.argv[3]) ? "http://"+process.argv[2]+":"+process.argv[3] :
    "http://"+process.env.TEST_WS_SERVER_IP+":"+ process.env.TEST_WS_SERVER_PORT;

console.log("INFO: ", userParams);

var socket = require('socket.io-client');
// var socketOns = require("./testOns.js");
// socketOns.init(socket);


var rabbit = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var wsClients = [];

// step1();//reg authPhone and authSms tests
// step2();//add asset or partner or cost - ok
// step3();//rename asset
// step4();//delete asset
// step5();//transfer
// step6();//get history
// step7();//decline transfer
// step8();//accept transfer
// step9();//get assets and partners list
// step10();//setProfile
// step11();//getProfile
// step12();//set push token
step13();//send APNs push notification
// step13_1();//send GCM push notification
// step14();//set asset->asset|partner saldo
// step15();//accept new partner saldo
// step16();//decline new partner saldo
// step17();//listener for incoming ws-messages
// step18();//transfer from temporary asset to asset
// step19();//delete action from temporary asset and decrement saldo
// step20();//updateGoods
// step21();//deleteTransactionsHistory
// step22();//deleteAccount
// step32();//reg all users into jabber chat
//
/**************FIRST - REG/AUTH/SMS TEST ***********************/
function step1() {
    var sock = socket.connect(userParams);
    sock.on('connect', function () {
        var testPhone = Math.round(99999999999 * Math.random());

        // sock.emit("authPhone", {phone: 79251338464, requestId: 223});//ok
        sock.emit("authSms", {phone: 79251338464, code: 999999, requestId: 223});//ok

        sock.on("ack", function(data) {
            console.log("on.ack data", data);
        });

        sock.on("setToken", function(data) {
            console.log("on.setToken data", data);
        });

    });
}
/**************END REG/AUTH/SMS TEST ***********************/

/**************SECOND - ADD ASSET TEST*********************/
function step2() {

        var sock = require('socket.io-client').connect(userParams);
        sock.on("ack", function (data) {
            console.log("ack." + data.info.action + ", status = " + data.status+", error="+
                data.error);//ok!!!
        });

        var curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";
            // curToken = "debd5eb174186b8b647a6e0ac027707a452f329c";
        // var myPhone = 79207209977;//нужен для добавления актива-партнера

        console.log("curToken", curToken);

        sock.on('connect', function () {
            count++;
            console.log("["+count+"] connect " + curToken+" "+sock.id);

            //вариант для создания актива //ok
            var params = {
                token:curToken,
                name: "Касса Ромы(2)",
                type: "asset",
                saldo: 0,
                requestId: 123
            };


            // вариант для создания партнера
                /*var params = {
                token:curToken,
                name: "Партнер Нейм(3)",
                type: "partner",
                saldo: 10,
                partnerPhone: 72222222222,
                requestId: 123
                // myPhone: myPhone
            };*/

            // вариант для создания партнера
/*            var params = {
             token:curToken,
             name: "Расход нового типа",
             type: "asset",
             isCost:1,
             saldo: 500
             // partnerPhone: 72222222225,
             // myPhone: myPhone
             };*/



            sock.on("ack", function (data) {
                console.log("ack data", data);
            });

            sock.on("addAsset", function (data) {
                console.log("addAsset.info:", data);
            });

            sock.emit("addAsset", params);
            // sock.emit("addAsset", params);
            // sock.emit("addAsset", params);
        });


}
/**********END ADD ASSET TEST*********************/


/*******THRID - RENAME ASSETS**********/
function step3() {
    pool.getConnection(function(err, connection) {

        var sock = require('socket.io-client').connect(userParams);
        sock.on("ack", function (data) {
            console.log("ack.", data);//ok!!!
        });

        var curToken = "0c7b2622272000d47ca1164ca9f02f37e97d1c4a";
        curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";
        sock.on('connect', function () {

            var params = {
                token:curToken,
                newName: "Не Илья Соловьев",
                assetId: 2998,
                requestId:230
            };
            sock.emit("renameAsset", params);

        });
    });
}
/*********END RENAME ASSETS************/


/*******FOURTH - DELETE ASSETS**********/
function step4() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack.", data);//ok!!!
    });

    var curToken = "0c7b2622272000d47ca1164ca9f02f37e97d1c4a";
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//Me

    sock.on('connect', function () {
        var params = {
            token:curToken,
            assetId: 365//temporary_asset
            ,requestId:12345
        };
        sock.emit("deleteAsset", params);
    });

}
/*********END DELETE ASSETS************/


/*******FIVTH - MAKE TRANSFER**********/
function step5() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status+", data = ", data);//ok!!!
    });

    var curToken = "4b9fb7cc04391c5e64bc824ee68f9e2b72662ec5";//Roman
    curToken = "1798588d6426f8aec8a4c31b567a1059f01258bf";//Ibragim
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//Me
    console.log(curToken);

    sock.on('connect', function () {



        //вариант для тестирования не правильной транзакции (с "актив 1" на "актив 1")
        var params = {
            token:curToken,
            from: 1,
            to: 1
            ,requestId: 87
        };

        //вариант для переброса средств со временного актива на актив
/*        var params = {
         token:curToken,
         from: 58,
         to: 5,
         actionHash:""//TODO: добавить
         };*/

        //вариант для переброса средств с актива на актив
/*        var params = {
            token:curToken,
            from: 1,
            to: 45,
            amount: 1, //сумма зачисления средств на актив зачисления
            outgoingFromAsset:3, //сумма списания с актива списания
            comment1:"Списали 3 рубля",
            comment2:"Зачислили 1 рубль"
        };*/

        //вариант для отправки запроса на перевод средств со своего актива на актив партнера
/*        var params = {
            token:curToken,
            from: 1,//Kassa 1 (in user id=1)
            to: 16,//Partner 0 (in user id=1)
            amount: 5,//сумма зачисления на актив-партнер
            outgoingFromAsset:51, //сумма списания с актива типа "актив"
            comment1:"Списал у себя 5р. в пользу др. юзера",
            comment2:"Зачислил др. юзеру 51р."
        };*/

        //вариант для отправки запроса на перевод средств со своего актива на актив партнера
        //второй юзер отправляет первому прямой перевод

/*        var params = {
            token:curToken,
            from: 1,
            to: 16,
            amount: 5,
            outgoingFromAsset:5,
            comment1:"Прямой перевод",
            comment2:"Прямой перевод"
        };*/

        //вариант для отправки запроса на перевод средств на свой актив с актива партнера
/*        var params = {
            token:curToken,
            from: 15,
            to: 28,
            amount: 10,
            outgoingFromAsset:10,
            // myPhone: myPhone,
            comment1:"Коммент 1-му партнеру",
            comment2:"Коммент 2-му партнеру"
        };*/

        //вариант для отправки запроса на перевод средств с 1-го партнера 2-му партнеру
/*        var params = {
             token:curToken,
             from: 36,//Alexey
             to: 24,//Ibragim
             amount: 10,
             outgoingFromAsset:10,
             // myPhone: myPhone,
             comment1:"коммент 1",
             comment2:"коммент 2"
             };*/

        sock.emit("transfer", params);
    });

}
/*********END MAKE TRANSFER************/

/******************SIXTH - GET ASSET AND PARTNER HISTORIES****************/
function step6() {

    var sock = require('socket.io-client').connect(userParams);

    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status,
        data);//ok!!!
    });

    sock.on("getAssetHistory", function (data) {
        console.log("history: ");//ok!!!
        console.log(data.info.history);
    });

    var curToken = "75c45dc5d15cf288f713bd67839d1988a580000d";
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";
    console.log(curToken);

    var _asset_id = 28;
    
    var params = {token:curToken,
        assetId:_asset_id,
        // offset:30,
        requestId: 9
    };

    sock.on('connect', function () {
        sock.emit("getAssetHistory",params);
    });

}
/*******************END GET ASSET AND PARTNER HISTORIES*******************/


/***************SEVENTH - DECLINE PARTNER OUTGOING TRANSFER***************/
function step7() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        // console.log("ack." + data.info.action + ", status = " + data.status);//ok!!!
        console.log("ack." + data.info.action + ", status = " + data.status+", data = ", data);//ok!!!;
    });

    sock.on("sendAssetHistory", function (data) {
        console.log("history: ");//ok!!!
        console.log(data.info.history);
    });

    var curToken = "361b5b5350eab3e07145706ed96a37819e38f6d4";//777
    // curToken = "8c5425aaec31403048a7be966ffa79a32aa46f41";//888

    console.log(curToken);

    sock.on('connect', function () {

        // var _asset_id = 106;//payment_sum = 1
        // var _actionId = 18;//payment_sum = 1
        var params = {
            token:curToken,
            actionHash:"fbcc22264ab59fbb7e785b0e1c6d73145ca1d25c"
        };
        // console.log(params);
        sock.emit("declineTransfer",params);

    });

}
/******************END DECLINE PARTNER OUTGOING TRANSFER*******************/


/****************EIGHTH - ACCEPT PARTNER OUTGOING TRANSFER*****************/
function step8() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status+", data = ", data);//ok!!!;
    });

    sock.on("sendAssetHistory", function (data) {
        console.log("history: ");//ok!!!
        console.log(data.info.history);
    });

    var curToken = "e69dc62cb034c4e57bd023230e11ef95abef1e4a";//7777
    curToken = "293a8c2e45db41ba817e0aec244c2ddef0d7c3fc";//888
    // var myPhone = 72222222222;//нужен для перевода к еще не существующему юзеру-партнеру
    console.log(curToken);

    sock.on('connect', function () {

        //подтверждаем перевод с актива на партнер
        var params = {
            token: curToken,
            // transferAssetId: 297,//777, Развлечения
            transferAssetId: 306,//888, Развлечения
            actionHash:"748bf3b59ea2cccc7ba76cc9cfec37b554eefae2"
        };

        //подтверждаем перевод с партнера на актив //ok
/*         var params = {
             token:curToken,
             assetId:19,
             transferAssetId: 2,//актив, на который зачисляем(или с которого переводим)
             // полученные средства
             actionId: -1,
             actionHash:"320ae87ea9b5f032903e5eef49c133b52680c5cf"
             //в воркере обрабатывать 3 актива сразу, а так же актив списания и записи
             // "не просмотренные" для всех затронутых активов
         };*/

        // console.log(params);
        sock.emit("acceptTransfer",params);

    });

}
/*******************END ACCEPT PARTNER OUTGOING TRANSFER*******************/

/*****************NINTH - GET ASSETS AND PARTNERS LIST ********************/
function step9() {
    var sock = require('socket.io-client').connect(userParams);

/*    var socketOns = require("./testOns.js");
    socketOns.init(sock)
*/

    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status+", error="+
            data.error, data);//ok!!!
    });

    sock.on("getAssets", function(data) {
        console.log( colors.yellow("on.getAssets"), data);
    });

    var curToken = "db19be28ccd8b7f6de275a8ab40026d6a81c2de9";
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";
    // var myPhone = 79207209977;//нужен для добавления актива-партнера
    // myPhone = 71111111111;

    console.log("curToken", curToken);

    sock.on('connect', function () {

        var params = {token:curToken, requestId: 2349};
        sock.emit("getAssets", params);
    });
}
/*********************END GET ASSETS AND PARTNERS LIST ********************/


/*****************TENTH - SET PROFILE ********************/
function step10() {
    var sock = require('socket.io-client').connect(userParams);

    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status+", error="+
            data.error, "data=", data);//ok!!!
    });

/*    sock.on("getAssets", function(data) {
        console.log( colors.yellow("on.getAssets"), data);
    });*/

    var curToken = "0c7b2622272000d47ca1164ca9f02f37e97d1c4a";
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//Me

    console.log("curToken", curToken);

    sock.on('connect', function () {
        var params = {
            token:curToken,
            name: "User 2",
            // avatar:"avatar.png",
            address:"г. Ростов-на-Дону, ул. Социалистическая 55, кв. 115",
            city:"г. Ростов-на-Дону",
            company:"Owner",
            business: "IT",
            position: "Lead",
            requisites:"ИП: 1232423545435, р/о: 3300 3312 1778 3344, БИК: 618460",
            requestId:7898
        };

        sock.emit("setProfile", params);
        // sock.emit("addAsset", params);
        // sock.emit("addAsset", params);
    });
}
/*********************END SET PROFILE ********************/

/*****************ELEVENTH - GET PROFILE ********************/
function step11() {
    var sock = require('socket.io-client').connect(userParams);

    sock.on("ack", function (data) {
        console.log("ack.", data);//ok!!!
    });

        sock.on("getProfile", function(data) {
     console.log( colors.yellow("on.getProfile"), data);//, data.info.goods[0].images);
     });

    var curToken = "0c7b2622272000d47ca1164ca9f02f37e97d1c4a";
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//Me

    console.log("curToken", curToken);

    sock.on('connect', function () {
        var params = {
            token:curToken,
            userPhone: 792513384640//обязательный параметр, т.к. по нему мы узнаем данные о ЛЮБОМ юзере
            ,requestId:987
        };

        sock.emit("getProfile", params);
        // sock.emit("addAsset", params);
        // sock.emit("addAsset", params);
    });
}
/*********************END GET PROFILE ********************/

/**********************SET PUSH TOKEN*********************/
function step12() {

    console.log("step12");
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack.", data);//ok!!!
    });

    var curToken = "0c7b2622272000d47ca1164ca9f02f37e97d1c4a";
    curToken = "ec38ee6b3014da548b211b82163a5332274ae3a8";//Me
    var pushToken = "test-android-push-token";

    console.log("curToken", curToken);

    sock.on('connect', function () {
        var params = {
            token:curToken,
            pushToken: pushToken,
            requestId:98989,
            device:"android"
        };

        sock.emit("setPushToken", params);
        // sock.emit("addAsset", params);
        // sock.emit("addAsset", params);
    });

}
/**********************END PUSH TOKEN*********************/

/*****************SEND APNS PUSH NOTIFICATION******************/
function step13() {

    var connOptions = {
        batchFeedback: true,
        interval: 300,
        cert: "./cert.pem"
        ,key: "./key.pem"
       ,passphrase: "12345"
       ,production: true
};

    var message = "test notification | тестовый пуш";

    // Создаём подключение к APNS
    var apnConn = new apn.Connection(connOptions);
    var feedback = new apn.Feedback(connOptions);

    feedback.on('feedback', function (devices) {
        console.log("devices");
        console.log(devices);
    });

    var note = new apn.Notification();
    note.expiry = Math.floor(Date.now() / 1000) + 3600;
    // note.badge = -1;
    note.alert = message || "new Parner message";
    note.payload = {assetId:24};
    /*if (typeof payload === 'object') {
        note.payload = payload;
    }*/
    apnConn.pushNotification(note, "18c2717c15b7425c02602daf21684a9e88bd0f83ca20fd9f17b28ceee0d9599a");
}
/***************END SEND APNS PUSH NOTIFICATION****************/

/*****************SEND GCM PUSH NOTIFICATION******************/
function step13_1() {


    var message = new gcm.Message({
        data: { key1: 'msg1' }
    });


    var sender = new gcm.Sender(process.env.GCM_API_KEY);
    var regTokens = ['fxG7eqPCi-w:APA91bExNaQHwV-fjK7LpWiBZXRl2_HBNgdxghIaZb3w6TSXNOOofsph7bHM-slvN9N-AHfn612mNW_-sRUm3S6KHW0vTaBd_IYqoIDQfE7zT-NpsWbseQyGSa5W0wewfETzymyhWTxf'];

    sender.send(message, { registrationTokens: regTokens }, function (err, response) {
        if(err) console.error(err);
        else 	console.log(response);
    });
}
/***************END SEND GCM PUSH NOTIFICATION****************/




/************************SET NEW SALDO***********************/
function step14() {
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack.", data);//ok!!!
    });

    var curToken = "0c7b2622272000d47ca1164ca9f02f37e97d1c4a";
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//777

    console.log(curToken);

    sock.on('connect', function () {
        //вариант для установки нового сальдо на актив
/*        var params = {
            token:curToken,
            assetId:114,
            newSaldo: 50
        };*/

        //вариант для установки нового сальдо партнеру
        var params = {
            token:curToken,
            assetId:472,
            newSaldo: 1000,
            requestId:998
        };

        sock.emit("setSaldo", params);
    });
}
/********************END SET NEW SALDO***********************/

/******************ACCEPT NEW SALDO**************************/
function step15() {
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status);//ok!!!
    });

    var curToken = "1e00158d688b0c698ac97384f066e227fac60ae8";
    // curToken = "4ab8a253b75d39a04235dd92a4ddf6e4a020e400";

    console.log(curToken);

    sock.on('connect', function () {

        var params = {
            token:curToken,
            actionHash:"b43dfc61c50d5fe57de8f62e0098ff87acc9a34a"
        };

        sock.emit("acceptNewSaldo", params);
    });
}
/*****************END ACCEPT NEW SALDO***********************/

/*******************DECLINE NEW SALDO************************/
function step16() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status);//ok!!!
    });

    var curToken = "1e00158d688b0c698ac97384f066e227fac60ae8";
    // curToken = "4ab8a253b75d39a04235dd92a4ddf6e4a020e400";

    console.log(curToken);

    sock.on('connect', function () {

        var params = {
            token:curToken,
            actionHash:"4446af5668893eb4ddf942a96b055701b017ff63"
        };

        sock.emit("declineNewSaldo", params);
    });
}
/*****************END DECLINE NEW SALDO**********************/


/******************LISTENING FOR INCOMING MESSAGES***********/
function step17() {
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status);//ok!!!
    });

    sock.on("status", function (data) {
        console.log("status: ", data);//ok!!!
    });


    //TODO: добавить отправку подтверждения серверу. иначе - сервер должен еще 3-5 раз попробовать отправить
    // ws-сообщение, а затем, если по-прежнему нет подтверждения, выполнить альтернативное действие(отправка push),
    // либо прекратить попытки отправки ws-сообщения
    sock.on("ws.incoming.messages", function (data) {
        console.log( colors.green("ws.incoming.messages: "), data);//ok!!!
    });

    var curToken = "5add4d2f73eecc0927f7952c0c505fea0cd0424f";//I
    // curToken = "4ab8a253b75d39a04235dd92a4ddf6e4a020e400";
    curToken = "361b5b5350eab3e07145706ed96a37819e38f6d4";//777
    //
    console.log(curToken);

    sock.on('connect', function () {

        var params = {
            token:curToken
        };

        sock.emit("ionline", params);
    });
}
/**************END LISTENING FOR INCOMING MESSAGES **********/


/**************TRANSFER FROM TEMPORARY ASSET TO ASSET ***************************/
function step18() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status + ", data = ", data);//ok!!!
    });

    var curToken = "5add4d2f73eecc0927f7952c0c505fea0cd0424f";//Me
    console.log(curToken);

    sock.on('connect', function () {

        //вариант для переброса средств со временного актива на актив
        var params = {
            token: curToken,
            from: 58,
            to: 5,
            actionHash: "481fec83247f6fe421bee467b87c39ead18c7fe3"
        };

        sock.emit("transferFromTemporaryAsset2Asset", params);
        //sock.emit("deleteFromTemporaryAsset", params);
    });
}
/*********END TRANSFER FROM TEMPORARY ASSET TO ASSET ****************************/

/******************DELETE FROM TEMPORARY ASSET **********************************/
function step19() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status + ", data = ", data);//ok!!!
    });

    var curToken = "5add4d2f73eecc0927f7952c0c505fea0cd0424f";//Me
    console.log(curToken);

    sock.on('connect', function () {

        var params = {
            token: curToken,
            actionHash: "310b3c71326e1a6a3ba7a9665c7477e126b523dc"
        };

        sock.emit("deleteFromTemporaryAsset", params);
    });
}
/****************END DELETE FROM TEMPORARY ASSET ********************************/


/******************************GOODS ZONE ***************************************/
function step20() {
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status + ", data = ", data);//ok!!!
    });

    var curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//Me
    console.log(curToken);

    sock.on('connect', function () {
        var params = {token:curToken,
            goods: [{
                    name: 'IT development 555',
                    images: [ {title:"[Фото 2]",
                        url:"https://hsto.org/storage2/913/544/291/9135442912ba504f671a304e151f7dc5.jpg"},
                        {title:"Moscow city", url:"https://i.ytimg.com/vi/NzagujOwJkI/hqdefault.jpg"}
                    ],
                    description: "[Making highload parfomance systems]",
                    site:"http://vk.com"
                },
                {
                    name: "IT Consulting",
                    images: [ {title:"[Фото 3]",
                        url:"https://hsto.org/storage2/913/544/291/9135442912ba504f671a304e151f7dc5.jpg"},
                        {title:"Moscow city", url:"https://i.ytimg.com/vi/NzagujOwJkI/hqdefault.jpg"}
                    ],
                    description: "[Info and Courses]",
                    site:"http://vk.com"
                }]
            , requestId:777
        };

        var goodsString = JSON.stringify(params.goods);

        console.log("goodsString", typeof goodsString);

        sock.emit("updateGoods", params);
    });

}
/***************************END GOODS ZONE***************************************/


/********************DELETE TRANSACTIONS HISTORY ********************************/
function step21() {
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack.", data);
    });

    var curToken = "55bfdcc7e88b391bb858400918603b7eafd1bb1a";//Me
    curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";

    console.log(curToken);

    sock.on('connect', function () {
        var params = {token:curToken,
            actionsIds:[267]
            , requestId: 987
        };

        sock.emit("deleteTransactionsHistory", params);
    });

}
/***********************END DELETE TRANSACTIONS HISTORY *************************/

/**********************DELETE ACCOUNT *******************************************/
function step22() {
    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack.", data);//ok!!!
    });

    var curToken = "89075efb0a1bd90c5bea91ed3960206d9a56c755";


    sock.on('connect', function () {
        var params = {token:curToken,
        requestId:9875};//INFO: здесь так же может быть добавлен параметр code, для ввода кода из смс

        sock.emit("deleteAccount", params);
    });

}
/**********************END DELETE ACCOUNT****************************************/


/**************************ALL USERS REGISTRED INTO CHAT*************************/
function step32() {

    pool.getConnection(function(err, connection) {

        var query = "SELECT phone, token FROM users";
        connection.query(query, function (err, rows) {
            if (err) {
                console.log("error", err);
            } else {

                for(var i = 0; i < rows.length; i++) {
                    var regChatMsg = {};
                    regChatMsg.action = "addNewUser";
                    regChatMsg.login = rows[i].phone;
                    regChatMsg.password = rows[i].token;
                    sendToChatQueue(regChatMsg);
                }

            }
        });

    });
}
/***********************END ALL USSERS REGISTRED INTO CHAT***********************/


//utils
function sendToChatQueue(jsonData) {

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