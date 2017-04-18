//ALL Socket ACK functions here
exports.init = init;
exports.authPhoneAck = authPhoneAck;
exports.authSmsAck = authSmsAck;
exports.getAssetsAck = getAssetsAck;
exports.addAssetAck = addAssetAck;


var io;
function init(_io) {
    io = _io;
}

function regPhoneAck(phone) {
    console.log("regPhone<-ACK");
    io.emit("ack", {status:"ok", info:{action:"regPhone", phone:phone} });
}

function authPhoneAck(phone) {
    console.log("authPhone<-ACK");
    io.emit("ack", {status:"ok", info:{action:"authPhone", phone:phone} });
}


function authSmsAck() {
    console.log("authSms<-ACK");
    io.emit("ack", {status:"ok", info:{action:"authSms"} });
}

function getAssetsAck() {
    console.log("getAssets<-ACK");
    io.emit("ack", {status:"ok", info:{action:"getAssets"} });
}

function addAssetAck() {
    console.log("addAsset<-ACK");
    io.emit("ack", {status:"ok", info:{action:"addAsset"} });
}