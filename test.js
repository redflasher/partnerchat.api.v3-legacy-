require('dotenv').config();
exports.authPhoneTest = authPhoneTest;
exports.authSmsTest = authSmsTest;
exports.setToken = setToken;
exports.getAssets = getAssetsAndPartnersTest;
exports.getAssetHistory = assetsHistoryTest;

var db = require("partner-db");
var prompt = require('prompt');
var _token;

var userParams = (process.argv[2] && process.argv[3]) ? "http://"+process.argv[2]+":"+process.argv[3] :
"http://"+process.env.TEST_WS_SERVER_IP+":"+ process.env.TEST_WS_SERVER_PORT;
var socket = require('socket.io-client')(userParams);
var socketAck = require("./testAcks.js");
socketAck.init(socket);

var socketOns = require("./testOns.js");
socketOns.init(socket);

///main(start test cycles)

//init
db.init(function () {
    try {
        preTests(function () {
            regTest(function () {
                authPhoneTest();
                //далее продолжаем из точки получения токена

            });
        });
    } catch (e) {
        console.log(e);
    }
});
//end init

//отсюда продолжаем тестирование с уже полученным токеном авторизации
function setToken(token) {
    console.log("setToken", token);
    _token = token;

    addAssetsAndPartnersTest(function () {
        // getAssetsAndPartnersTest();
        console.log('Start rename test?(y)');
        prompt.start();
        assetRenameTest(function () {

            prompt.get(['command'], function (err, result) {

                console.log('  command: ' + result.command);

                if(result.command == 'y') {
                    console.log("rename test started...");
                    assetRenameTest(function(){});
                } else {
                    prompt.start();
                }
                // assetDeleteTest
            });
        });
    });

}



/**
 return false;
 //[assets]
 //TODO: Delete - delete a one or more asset(s)
 testContainer().deleteAssets([1, 2]);

 testContainer().addAsset("Kassa 2", "asset", 0);
 testContainer().addAsset("Вася Иванов", "partner", -1000, 78888888888);//Вася нам дал 1000р.


 //[Transfers]
 //шлем 100 от "Kassa 2" текущего юзера(id=4) -> Вася Иванов 78888888888(asset_id=5) сумму 100(sum1), зачисляя Васе
 // долг в 120(sum2)
 testContainer().createTransfer(4, 5, 100, 120);

 //запрашиваем у Васи(asset_id=5) перевод в нашу пользу, на 5000 и в случае успеха кладем его в
 // "Kassa 2"(asset_id=4)
 testContainer().createTransfer(5, 4, -5000);

 //Read - look into .on-ws-handler
 //Update - look down (accept and decline methods)
 //Delete - alias for decline method
 //Accept - accept incoming transfer
 //INFO: assetId can be ONLY asset or cost (not another partner!)

 return true;

 //testContainer().acceptTransfer(from, to, assetId, sum0);

 //Decline - decline incoming transfer
 //testContainer().declineTransfer(from, to);

 //[partners]
 //Create - add a one partner
 // testContainer().addPartner();
 //Read - alias getAssets and getAssetHistory
 //Update - alias renameAsset
 //Delete - alias deleteAssets

 //[Icons] - a some icons for asset, partner and may be categories of costs
 //Create - not need for realised
 //Read
 testContainer().getIcons();
 //Update - not need for realised
 //Delete - not need for realised

 //[Categories of costs]
 //Create - add a category of cost
 //params: name, icon
 testContainer().addCategoryOfCost();

 //Read - list all exists categories for current user
 testContainer().getCategoriesOfCosts();

 //Update - rename a category of cost
 testContainer().renameCategoryOfCost();

 //Delete - delete a category(s) of cost(s)
 testContainer().deleteCategoriesOfCosts(categoryOfCostsArray);

 //[Profile]
 //Create - not need for realised
 //Read - look own profile
 testContainer().showMyProfile();
 //Read - look profile of another user
 testContainer().showProfile(userId);

 //Update - update ONLY own profile
 testContainer().updateProfile(firstName, middleName, lastName, birthday);
 //Update - upload a new user photo
 testContainer().updateProfilePhoto();

 //Delete - delete a user account (ONLY own profile!)
 testContainer().deleteProfile();

 //[User Shop]
 //Create - add a new product
 testContainer().addProduct();

 //Read - get a list of all products
 testContainer().getProducts();
 //Read - look full info about selected product (big image, name, description, site-link)
 testContainer().getProduct();

 //Update - update a product info(name, description, site-link)
 testContainer().updateProduct();
 //update - upload a new product photo
 testContainer().updateProductPhoto();

 //Delete - delete a product(ONLY own product(s)!)
 testContainer().deleteProducts(productsArray);
 */


socket.on('connect', function() {
    console.log("connect");
});
socket.on('event', function(data){
    console.log("event");
});
socket.on('disconnect', function(){
    console.log("disconnect");
});

//TESTS STACK
var tests = testContainer();
function preTests(cb) {
    // db.clearAllTables(function () {
    //     cb();
    // });
    cb();
}

function  regTest(cb) {
    tests.regPhone(76666666666);
    cb();
}

function authPhoneTest() {
    tests.authPhone(76666666666);
    // tests.authSms(76666666666, 999999);
}

function authSmsTest() {
    tests.authSms(76666666666, 999999);
}

function addAssetsAndPartnersTest(cb) {
    var params1 = {
        name: "Kassa 1",
        type: "asset",
        saldo: 0
    };

    var params2 = {
        name: "Вася Петров",
        type: "partner",
        saldo: 100,
        partnerPhone: 78888888888
    };

    var params3 = {
        name: "Путешествия",
        type: "cost_category",
        saldo: -150
    };


    tests.addAsset(params1);
    tests.addAsset(params2);
    tests.addAsset(params3);
    cb();
}

function getAssetsAndPartnersTest() {
    tests.getAssets(_token);
}

function assetsHistoryTest(asset_id) {
    tests.getAssetHistory(asset_id);
}

function assetRenameTest(cb) {
    tests.renameAsset(1, "Kassa 1 - renamed");
    tests.renameAsset(2, "Вася Петров - renamed");
    tests.renameAsset(3, "Путешествия - renamed");
    cb();
}

function assetDeleteTest(asset_id) {
    tests.deleteAsset(asset_id);
}
//END TESTS STACK



function testContainer() {
    var vm = this;


    vm.regPhone = function(phone) {
        socket.emit("regPhone",{phone:phone});
        console.log("test: regPhone...");
    };

    vm.authPhone = function(phone) {
        socket.emit("authPhone",{phone:phone});
        console.log("test: authPhone...");
    };

    //second step of auth
    vm.authSms = function(phone, code) {
        socket.emit("authSms",{phone:phone, code:code});
        console.log("test: authSms...");
    };

    //[assets]
    //Read - list all assets (also partners)
    vm.getAssets = function(token) {
        console.log("test: getAssets...");
        socket.emit("getAssets",{token:token});
    };

    /**
     * @param {number} _asset_id id Актива или партнера или категории расходов
     */
    vm.getAssetHistory = function(_asset_id) {
        socket.emit("getAssetHistory",{token:_token, assetId:_asset_id});
        console.log("test: getAssetHistory... asset_id= "+_asset_id);
    };

    vm.renameAsset = function(asset_id, newName) {

    };

    //TODO: Create - add a one asset
    /**
     * @param {string} params.name название нового актива
     * @param {string} params.type тип нового актива: "asset", "partner", "cost_category"
     * @param {Number} params.saldo первоначальное сальдо(разница между приходом и расходом актива)
     * @param {Number} params.partnerPhone Номер телефона партнера (ТОЛЬКО для актива типа "партнер")
     */
    vm.addAsset = function(params) {
        //TODO
        params.token = _token;
        console.log("test: addAsset...", params);
        socket.emit("addAsset",params);
    };

    /**
     * Отправляет приглашение (смс, push) другому юзеру (если он еще не пользователь программы)
     * Либо (если юзер уже пользователь программы) - предлагает ему установить связь (стать партнерами)
     * @param assetId
     * @param partnerPhone
     */
    vm.bindAssetWithPartner = function (assetId, partnerPhone) {
        //TODO
    };
    /**
     * принимаем приглашение стать партнерами
     * @param senderId
     */
    vm.acceptAssetWithPartner = function (senderId) {
        //TODO
    };

    /**
     * отклоняем приглашение стать партнерами
     * @param senderId
     */
    vm.declineAssetWithPartner = function (senderId) {
        //TODO
    };


    /** Rename a one asset [Update]
     * @param {Number} assetId id актива (партнера, категории расходов)
     * @param {string} newName новое название актива
     */
    vm.renameAsset = function(assetId, newName) {
        //TODO
        console.log("test: renameAsset...");
        socket.emit("renameAsset",{token:_token, assetId:assetId, newName: newName});
    };

    //TODO: Delete - delete a one or more asset(s)
    /**
     * @param {Array} assetsArr массив из asset_id, которые нужно удалить
     */
    vm.deleteAssets = function(assetsArr) {
        //TODO
        console.log("test: deleteAssets...");
    };

    //[partners]
    //Create - add a one partner
    // vm.addPartner = function() {
    // 	//TODO
    // 	console.log("test: addPartner...");
    // };
    //Read - alias getAssets and getAssetHistory
    //Update - alias renameAsset
    //Delete - alias deleteAssets

    //[Icons] - a some icons for asset, partner and may be categories of costs
    //Create - not need for realised
    //Read
    vm.getIcons = function() {
        // TODO
        console.log("test: getIcons...");
    };
    //Update - not need for realised
    //Delete - not need for realised

    //[Categories of costs]
    //Create - add a category of cost
    //params: name, icon
    vm.addCategoryOfCost = function() {
        //TODO
        console.log("test: addCategoryOfCost...");
    };

    //Read - list all exists categories for current user
    vm.getCategoriesOfCosts = function() {
        //TODO
        console.log("test: getCategoriesOfCosts...");
    };

    //Update - rename a category of cost
    vm.renameCategoryOfCost = function() {
        //TODO
        console.log("test: renameCategoryOfCost...");
    };

    //Delete - delete a category(s) of cost(s)
    vm.deleteCategoriesOfCosts = function(categoryOfCostsArray) {
        //TODO
        console.log("test: deleteCategoriesOfCosts...");
    };

    //[Transfers]
    //Create - add a new transfer (from user to partner, from partner to user, from asset to asset)
    /**
     * @param {Number} fromMyAssetId id (актива, партнера, категории расхода), с которого переводим
     * @param {Number} toMyAssetId id (актива, партнера, категории расхода), куда переводим
     * @param {Number} sum1 сумма, которую списываем с from
     * @param {Number} [sum2] сумма, которую мы списываем со своего актива (ТОЛЬКО если мы переводим со своего
     * актива к партнеру. Если мы запрашиваем перевод ОТ партнера - этот параметр можно(нужно) опустить.
     */
    vm.createTransfer = function(fromMyAssetId, toMyAssetId, sum1, sum2) {
        //TODO
        if(!sum2) sum2 = sum1;
        console.log("test: createTransfer...");
    };

    //Read - look into .on-ws-handler
    //Update - look down (accept and decline methods)
    //Delete - alias for decline method
    //Accept - accept incoming transfer
    //INFO: assetId can be ONLY asset or cost (not another partner!)
    /**
     *
     * 	Подтверждаем перевод(как на получение денег, так и на их списание)
     * @param {number} actionId id действия по предложению транзакции (это ОТЛИЧАЕТСЯ от actionId того, кто
     * инициировал перевод!!!). Для обновления статуса действия ИНИЦИАТОРА действия
     * используем partner_id(на сервере).
     * @param {Number} assetId id (актива, партнера, категории расхода), откуда списать(или куда положить) деньги.
     * Если мы были инициатором перевода, то параметр assetId можно(нужно) опустить (он уже был указан ранее,
     * при вызове createTransfer).
     */
    vm.acceptTransfer = function(actionId, assetId) {
        //TODO
        console.log("test: acceptTransfer...");
    };

    //Decline - decline incoming transfer
    /**
     * Отклоняем входящий перевод (как на получение денег, так и на их списание)
     * @param {number} actionId id действия по предложению транзакции (это ОТЛИЧАЕТСЯ от actionId того, кто
     * инициировал перевод!!!). Для обновления статуса действия ИНИЦИАТОРА действия
     * используем partner_id(на сервере).
     */


    vm.declineTransfer = function(actionId) {
        //TODO
        console.log("test: declineTransfer...");
    };

    /**
     * Устанавливаем новое сальдо (для актива, партнера или категории расходов)
     * @param {Number} assetId id (актива, партнера или категории расходов), которому задаем новое сальдо
     * @param {Number} newSaldo значение нового сальдо
     */
    vm.setSaldo = function (assetId, newSaldo) {

    };

    /**
     * (Только при установке нового сальдо для партнера) - отправка подтверждения(согласия) о новом сальдо
     * @param {number} actionId id действия по установке нового сальдо(это ОТЛИЧАЕТСЯ от actionId того, кто предложил
     * установить новое сальдо!!!). Для обновления статуса действия ИНИЦИАТОРА действия
     * используем partner_id(на сервере).
     */
    vm.acceptNewSaldo = function (actionId) {
        //TODO
    };

    /**
     * (Только при установке нового сальдо для партнера) - отправка отказа принятия нового сальдо
     * @param {number} assetId id партнера, который предложил новое сальдо (это ОТЛИЧАЕТСЯ от assetId,
     * задаваемое в функции setSaldo, поскольку у каждого юзера партнеры записаны как активы и имеют свои собственные
     * id(как активы).
     */
    vm.declineNewSaldo = function (assetId) {
        //TODO
    };

    //[Profile]
    //Create - not need for realised
    //Read - look own profile
    vm.showMyProfile = function() {
        //TODO
        console.log("test: showMyProfile...");
    };
    //Read - look profile of another user
    vm.showProfile = function(userId) {
        //TODO
        console.log("test: showProfile...");
    };

    //Update - update ONLY own profile
    vm.updateProfile = function(firstName, middleName, lastName, birthday) {
        //INFO: all parameters required!		//TODO
        console.log("test: updateProfile...");
    };
    //Update - upload a new user photo
    vm.updateProfilePhoto = function() {
        //TODO
        console.log("test: updateProfilePhoto...");
    };

    //Delete - delete a user account (ONLY own profile!)
    vm.deleteProfile = function() {
        //get accept in popup first!
        console.log("test: deleteProfile...");
        //TODO
    };

    //[User Shop]
    //Create - add a new product
    vm.addProduct = function() {
        //TODO
        console.log("test: addProduct...");
    };

    //Read - get a list of all products
    vm.getProducts = function() {
        //TODO
        console.log("test: getProducts...");
    };
    //Read - look full info about selected product (big image, name, description, site-link)
    vm.getProduct = function() {
        //TODO
        console.log("test: getProduct...");
    };

    //Update - update a product info(name, description, site-link)
    vm.updateProduct = function() {
        //TODO
        console.log("test: updateProduct...");
    };
    //update - upload a new product photo
    vm.updateProductPhoto = function() {
        //TODO
        console.log("test: updateProductPhoto...");
    };

    //Delete - delete a product(ONLY own product(s)!)
    vm.deleteProducts = function(productsArray) {
        //TODO
        console.log("test: deleteProducts...");
    };


    return vm;
}