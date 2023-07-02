'use strict';

const { Sequelize } = require("sequelize");
const config = require('../config');
const sequelize = new Sequelize(config['postgreSql'].database, config['postgreSql'].userName, config['postgreSql'].password, config['postgreSql']['options']);
console.log("Connected Postgre Connection");
initSequelizeErrorHandling();
const { DatabaseError } = require('../modules/error');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const env = process.env.NODE_ENV || "development";
let mongoUri = config['mongoDBOhlc']['uri'] + `/coinbutler_spot_${env}`;
if(config.mongoDBOhlc.user) {
    mongoUri = mongoUri+`_${config.mongoDBOhlc.user}`;
}
let connectionPool =  mongoose.createConnection(mongoUri,  config['mongoDBOhlc']['options'],(err, data)=>{
    if(err){
        console.error(err);
    }
    console.info('Connected mongoose Connection')
});


let instance = null;

class ModelManager {
    constructor() {
        this.sequelize = sequelize;
        this.Sequelize = Sequelize;
        this.mongoose = mongoose;
    }
    getModelFileList() {
        return [
            'user.js', 'strategy.js', 'orderPlan.js', 'order.js',
            'receipt.js', 'strategyBacktesting.js', 'privateSocket.js', 'slippage.js',
            'tradingContest.js','commission.js','admin/adminUser.js', 'admin/layerNotice.js',
            'admin/rollingNotice.js', 'admin/telegram.js', 'admin/email.js',
        ];
    }

    getMongoModelFileList(){
        return [
            'orderLog','adminLog','errorLog','userLog','strategyIndicatorLog', 'statistics'
        ]
    }

    async syncAllDB() {
        try {
            const fileNameList = this.getModelFileList();
            const db = {};
            const modelOptions = process.env.NODE_ENV === 'product' ? {} : {alter: true};
            for(const fileName of fileNameList) {
                const model = require(`./${fileName}`);
                model.initModel(sequelize);
                await model.sync(modelOptions);
                db[model.name] = model;
            }
            for(const modelName in db) {
                if(db[modelName].relationModel && typeof db[modelName].relationModel == 'function') {
                    db[modelName].relationModel();
                }
            }
            console.log("Complete Postgre Connection Sync");

            const mongoModelFileNameList = this.getMongoModelFileList();
            for(const fileName of mongoModelFileNameList){
                const model = require(`./mongo/${fileName}`);
                this[fileName] = model(connectionPool);
            }


        }
        catch (e) {
            console.log(e);
            throw e;
        }
    }



    async syncOhlcDBOnly(exchangeName) {
        const mongoClient = await MongoClient.connect(config['mongoDBOhlc']['uri'], config['mongoDBOhlc']['options']);
        console.log("Connected Mongodb Ohlc Connection");
        this.ohlcDb = mongoClient.db(`ohlc_${exchangeName}`);

    }
    async syncExchangeOhlcDb(exchangeNames){
        const mongoClient = await MongoClient.connect(config['mongoDBOhlc']['uri'], config['mongoDBOhlc']['options']);
        for(const exchangeName of exchangeNames){
            this[exchangeName] = mongoClient.db(`ohlc_${exchangeName}`);
            console.log(`Connected Mongodb ${exchangeName}Ohlc Connection`);
        }
        return;
    };


    disconnectDB() {
        this.sequelize.close().catch(err => {console.log(err)});
    }

    get User () {
        return require('./user');
    }
    get OrderPlan() {
        return require('./orderPlan');
    }
    get BasicOrderPlan() {
        return require('./subClasses/basicPlan');
    }
    get DefaultOrderPlan() {
        return require('./subClasses/defaultPlan');
    }
    get TrendLineOrderPlan() {
        return require('./subClasses/trendLinePlan');
    }
    get StrategyOrderPlan() {
        return require('./subClasses/strategyPlan');
    }
    get Order() {
        return require('./order');
    }
    get Strategy() {
        return require('./strategy');
    }
    get StrategyBacktesting() {
        return require('./strategyBacktesting');
    }
    get Receipt() {
        return require('./receipt');
    }
    get Slippage() {
        return require('./slippage');
    }
    get PrivateSocket() {
        return require('./privateSocket');
    }
    get TradingContest() {
        return require('./tradingContest');
    }
    get Commission() {
        return require('./commission');
    }
    get AdminUser(){
        return require('./admin/adminUser');
    }
    get Telegram(){
        return require('./admin/telegram');
    }
    get Email(){
        return require('./admin/email');
    }
    get LayerNotice(){
        return require('./admin/layerNotice');
    }
    get RollingNotice(){
        return require('./admin/rollingNotice');
    }


    static getInstance() {
        if(instance == null) {
            instance = new ModelManager();
        }
        return instance;
    }
}

function initSequelizeErrorHandling () {
    const SequelizeModel = require('sequelize/lib/model');
    const orgFindAll = SequelizeModel.findAll;
    SequelizeModel.findAll = function() {
        return orgFindAll.apply(this, arguments).catch(err => {
            if(err instanceof DatabaseError) {
                throw err;
            }
            throw new DatabaseError(err.parent);
        })
    };

    const orgCreate = SequelizeModel.create;
    SequelizeModel.create = function() {
        return orgCreate.apply(this, arguments).catch(err => {
            if(err instanceof DatabaseError) {
                throw err;
            }
            throw new DatabaseError(err.parent);
        })
    };

    sequelize.query = function() {
        return this.Sequelize.prototype.query.apply(this, arguments).catch(err => {
            if(err instanceof DatabaseError) {
                throw err;
            }
            throw new DatabaseError(err.parent);
        })
    };
}
module.exports = ModelManager.getInstance();

