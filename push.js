// Чтение настроек из дот-файла
require('dotenv').load();

// Импорты
var apn = require('apn');
var util = require('./util');
var log = require('./log');

var connOptions = {
    batchFeedback: true,
    interval: 300
};

connOptions.cert = './apns-push-certs/cert.pem';
connOptions.key = './apns-push-certs/cert-key.pem';
connOptions.production = true;


// Создаём подключение к APNS
var apnConn = new apn.Connection(connOptions);
var feedback = new apn.Feedback(connOptions);

// Если не удалось доставить уведомление устройству, удаляем его из списка
feedback.on('feedback', function (devices) {
    for (var i = 0; i < devices.length; i++) {
        var token = devices[i].device.toString('hex');
        if (tokenToUser.hasOwnProperty(token)) {
            var userId = tokenToUser[token];
            delete tokenToUser[token];
            if (devices[userId] instanceof Array) {
                var userDevices = devices[userId];
                var index = userDevices.indexOf(token);
                if (index > -1) {
                    userDevices.splice(index, 1);
                }
            }
        }
    }
});

// Устройства пользователей для рассылки уведомлений
var devices = {};
var tokenToUser = {};

// Регистрация устройства для отправки уведомлений
exports.registerDevice = function (userId, token) {
    if (!(devices[userId] instanceof Array)) {
        devices[userId] = [];
    }
    var userDevices = devices[userId];
    try {
        // Проверяем валидность токена и сразу приводим к общему виду
        var dev = new apn.Device(token).toString();
        if (!util.inArray(userDevices, dev)) {
            userDevices.push(dev);
            tokenToUser[dev] = userId;
        }
        return true;
    } catch (e) {
        log.warn('invalid push notification token: ', token, e);
        return false;
    }
};

// Отправка пуш-уведомления на все устройства пользователя
exports.sendNotification = function (userId, message, payload) {
    if (!(devices[userId] instanceof Array) || devices[userId].length === 0) {
        return false;
    }
    var note = new apn.Notification();
    note.expiry = Math.floor(Date.now() / 1000) + 3600;
    note.badge = 1;
    note.alert = message;
    if (typeof payload === 'object') {
        note.payload = payload;
    }
    return false !== apnConn.pushNotification(note, devices[userId]);
};

// Проверка корректности типа пуш-уведомления
exports.checkPushNotificationType = function (type) {
    return type === 'gcm' || type === 'apns';
};
