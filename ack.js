//ALL Socket ACK functions here

exports.init = init;
exports.regPhoneAck = regPhoneAck;
exports.authPhoneAck = authPhoneAck;
exports.authSmsAck = authSmsAck;
exports.getAssetsAck = getAssetsAck;
exports.getAssetHistoryAck = getAssetHistoryAck;
exports.addAssetAck = addAssetAck;
exports.renameAssetAck = renameAssetAck;

exports.deleteAssetAck = deleteAssetAck;

exports.transferAck = transferAck;
exports.declineTransferAck = declineTransferAck;
exports.acceptTransferAck = acceptTransferAck;

exports.setProfileAck = setProfileAck;
exports.getProfileAck = getProfileAck;

exports.setPushTokenAck = setPushTokenAck;

exports.setSaldoAck = setSaldoAck;
exports.acceptNewSaldoAck = acceptNewSaldoAck;
exports.declineNewSaldoAck = declineNewSaldoAck;

exports.ionlineAck = ionlineAck;

exports.transferFromTemporaryAsset2AssetAck = transferFromTemporaryAsset2AssetAck;
exports.deleteFromTemporaryAssetAck = deleteFromTemporaryAssetAck;

exports.updateGoodsAck = updateGoodsAck;

exports.deleteTransactionsHistoryAck = deleteTransactionsHistoryAck;

exports.deleteAccountAck = deleteAccountAck;



var colors = require('colors/safe');

require( "console-stamp" )( console, { pattern : "dd/mm/yyyy HH:MM:ss.l" } );


var io;
function init(_io) {
	io = _io;
}


function regPhoneAck(status, error, socketId, requestId) {
    _ackSender("regPhone", status, error, socketId, requestId);
}

function authPhoneAck(status, error, socketId, requestId) {
	_ackSender("authPhone", status, error, socketId, requestId);
}

function authSmsAck(status, error, socketId, requestId) {
	_ackSender("authSms", status, error, socketId, requestId);
}

function addAssetAck(status, error, socketId, requestId) {
	console.log( colors.green("addAssetAck"), status, error, socketId, requestId );
    _ackSender("addAsset", status, error, socketId, requestId);
}

//INFO: may be deprecated
function getAssetsAck(status, error, socketId, requestId) {
	_ackSender("getAssets", status, error, socketId, requestId);
}

function getAssetHistoryAck(status, error, socketId, requestId) {
    _ackSender("getAssetHistory", status, error, socketId, requestId);
}

//TODO: need test
function renameAssetAck(status, error, socketId, requestId) {
    _ackSender("renameAssetAck", status, error, socketId, requestId);
}

//TODO:need test
function deleteAssetAck(status, error, socketId, requestId) {
	_ackSender("deleteAssetAck", status, error, socketId, requestId);
}

//TODO: need test
function transferAck(status, error, socketId, requestId) {
    _ackSender("transferAck", status, error, socketId, requestId);
}

//TODO: need test
function declineTransferAck(status, error, socketId, requestId) {
	_ackSender("declineTransferAck", status, error, socketId, requestId);
}

//TODO: need test
function acceptTransferAck(status, error, socketId, requestId) {
	_ackSender("acceptTransferAck", status, error, socketId, requestId);
}

function setProfileAck(status, error, socketId, requestId) {
	_ackSender("setProfileAck", status, error, socketId, requestId);
}

function getProfileAck(status, error, socketId, requestId) {
	_ackSender("getProfileAck", status, error, socketId, requestId);
}

function setPushTokenAck(status, error, socketId, requestId) {
	_ackSender("setPushTokenAck", status, error, socketId, requestId);
}

function setSaldoAck(status, error, socketId, requestId) {
	_ackSender("setSaldoAck", status, error, socketId, requestId);
}

function acceptNewSaldoAck(status, error, socketId, requestId) {
	_ackSender("acceptNewSaldoAck", status, error, socketId, requestId);
}

function declineNewSaldoAck(status, error, socketId, requestId) {
	_ackSender("declineNewSaldoAck", status, error, socketId, requestId);
}

function ionlineAck(status, error, socketId, requestId) {
	_ackSender("ionlineAck", status, error, socketId, requestId);
}

function transferFromTemporaryAsset2AssetAck(status, error, socketId, requestId) {
    _ackSender("transferFromTemporaryAsset2AssetAck", status, error, socketId, requestId);
}

function deleteFromTemporaryAssetAck(status, error, socketId, requestId) {
    _ackSender("deleteFromTemporaryAssetAck", status, error, socketId, requestId);
}

function updateGoodsAck(status, error, socketId, requestId) {
	_ackSender("updateGoodsAck", status, error, socketId, requestId);
}

function deleteTransactionsHistoryAck(status, error, socketId, requestId) {
	_ackSender("deleteTransactionsHistoryAck", status, error, socketId, requestId);
}

function deleteAccountAck(status, error, socketId, requestId) {
	_ackSender("deleteAccountAck", status, error, socketId, requestId);
}

/**
 * Универсальная точка отправки подтверждений ("интерфейс")
 * @param actionName название подтверждаемого метода API
 * @param status статус подтверждения (ok - если успешно обработан, error - в случае ошибки)
 * @param error описание ошибки (если есть)
 * @private
 */
function _ackSender(actionName, status, error, socketId, requestId) {

    console.log( colors.green("_ackSender"), actionName, status, error, socketId, requestId );

	if(socketId) {
        if(Object.keys(io.sockets.sockets).length == 0 ) return false;

        if(!io.sockets.connected[socketId]) {
            setTimeout(function () {
                    _ackSender(actionName, status, error, socketId, requestId);
            },
            1000);
            return false;
        }

		if (error) {
            io.sockets.connected[socketId].emit("ack", {status: status, info: {action: actionName, error: error,
				requestId: requestId}});
		} else {
            io.sockets.connected[socketId].emit("ack", {status: status, info: {action: actionName,
				requestId: requestId}});
		}
	} else {

		if (error) {
			io.emit("ack", {status: status, info: {action: actionName, error: error, requestId: requestId}});
		} else {
			io.emit("ack", {status: status, info: {action: actionName, requestId: requestId}});
		}
	}
}