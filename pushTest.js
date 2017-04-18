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

var rabbit = require("amqplib").connect('amqp://'+process.env.RABBITMQ_LOGIN+":"+
    process.env.RABBITMQ_PASS+"@"+process.env.RABBITMQ_SEVER_IP);

var wsClients = [];

step13();//send APNs push notification

/*****************SEND APNS PUSH NOTIFICATION******************/
function step13() {

    var sock = require('socket.io-client').connect(userParams);
    sock.on("ack", function (data) {
        console.log("ack." + data.info.action + ", status = " + data.status+", data = ", data);//ok!!!
    });

    var curToken = "1e74574e6ea5d05b9b7acc4085e60b1c6e97ec26";//Roman
    // curToken = "7ad417c87e778c4e7a305a575bcb1f111706aea1";//Me
    console.log(curToken);

    sock.on('connect', function () {



        //вариант для тестирования не правильной транзакции (с "актив 1" на "актив 1")
        /*var params = {
            token:curToken,
            from: 1,
            to: 1
            ,requestId: 87
        };*/

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

        var params = {
         token:curToken,
         from: 3366,//Наличка
         to: 3417,//Илья
         amount: 5,
         outgoingFromAsset:5,
         comment1:"Прямой перевод",
         comment2:"Прямой перевод",
         requestId:1
         };

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
/***************END SEND APNS PUSH NOTIFICATION****************/