'use strict';

const { DataTypes, Deferrable } = require('sequelize');
const { BaseModel } = require('./base');
const { ORDER_ALIVE, CONVERT_INTEGER_VALUE } = require('../enum');

const { countryTimeDate } = require('../modules/utils');

const uuidv4 = require('uuid').v4;
const redisCtrl = require('../modules/redisCtrl');
const model = require('./internal');
const logger = require('../modules/logger');
const config = require('../config');
const utils = require('../modules/utils');
const { REALITYTYPE_WORD_MAP, INDICATORTYPE_WORD_MAP } = require('../enum');

const orderAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    uKey: {type: DataTypes.STRING, defaultValue: ''},
    userId: {type: DataTypes.UUID, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    orderPlanId: {type: DataTypes.UUID, references: {model: 'OrderPlans', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}}, //FK
    exchange: {type: DataTypes.STRING(10), allowNull: false},
    symbol: {type: DataTypes.STRING(20), allowNull: false, defalutValue:'XBT-USD'},
    bundle: {type: DataTypes.INTEGER, allowNull: false, defaultValue:0},
    side: {type: DataTypes.STRING, allowNull: false}, //Buy, Sell
    status: {type: DataTypes.STRING(20), allowNull: false, defaultValue: 'WAITING'}, // 전체 order status enum 내부
    active: {type: DataTypes.INTEGER, allowNull: false, defaultValue: ORDER_ALIVE.ACTIVE}, // 각 order에 상태
    planType: {type: DataTypes.STRING(20), allowNull: false, defaultValue: 'Basic'},
    tradeType: {type: DataTypes.STRING(20), allowNull: false, defaultValue: 'Limit'}, // Limit / Market\
    indicatorType: {type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OPEN'},
    origQty: {type: DataTypes.FLOAT, allowNull: false, defaultValue: 0},
    execQty: {type: DataTypes.FLOAT, allowNull: false, defaultValue: 0},
    filledQty: {type: DataTypes.FLOAT, allowNull: false, defaultValue: 0},
    filledAmount: {type: DataTypes.FLOAT, allowNull:false, defaultValue: 0},
    trailingValue: {type: DataTypes.FLOAT, defaultValue: 0},
    orderOptions: {type: DataTypes.JSON, defaultValue:{}},
    indicators: {type: DataTypes.JSON, allowNull: false, defaultValue:[]},
    createdDate: {type: DataTypes.DATE, defaultValue: DataTypes.NOW},
    updatedDate: {type: DataTypes.DATE, defaultValue: DataTypes.NOW},
    transactTime: {type: DataTypes.DATE, defalutValue: DataTypes.NOW},
    errorMessage: {type: DataTypes.STRING}
};

class OrderModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        OrderModel.init(orderAttributes, {sequelize, modelName: 'Order', indexes: [{unique: false, fields:['userId','orderPlanId']}, {unique:true, fields:['uKey']}, {unique:false, fields:['orderPlanId', 'indicatorType']}]},);
    }

    static relationModel() {
        OrderModel.belongsTo(model.OrderPlan, {as: 'orderPlan', foreignKey:"orderPlanId"});
        OrderModel.belongsTo(model.User, {as: 'user', foreignKey: "userId"});
    }

    static generateUKey(userId) {
        const userIdFirst = userId.split('-')[0];
        const uuid = uuidv4();
        const uuidFirst = uuid.split('-')[0];
        return `${userIdFirst}-${uuidFirst}`;
    }

    static makeNew(userId, orderPlanId, exchange, symbol, planType, orderInfo, execQty=0) {
        const orderForm = {
            userId: userId,
            orderPlanId: orderPlanId,
            exchange: exchange,
            symbol: symbol,
            side: orderInfo.side,
            planType: planType,
            tradeType: orderInfo.tradeType,
            indicatorType: orderInfo.indicatorType,
            bundle: orderInfo.bundle ? orderInfo.bundle : 1,
            origQty: orderInfo.qty,
            execQty: execQty,
            trailingValue: orderInfo.trailingValue ? orderInfo.trailingValue : 0,
            indicators: orderInfo.indicators,
            orderOptions: orderInfo.orderOptions,
            uKey: OrderModel.generateUKey(userId)
        };
        return OrderModel.build(orderForm);
    }

    static async getOrderOneWithParentModel(orderId) {
        const orderModel = await OrderModel.findByPk(orderId,{
            include:[{
                model: model['OrderPlan'],
                as: 'orderPlan',
                required: true
            }, {
                model: model['User'],
                as: 'user',
                required: true
            }]
        });
        return orderModel;
    }
    static async getOrdersWithParentModel(orderIdList, isAll=false) {
        const orderOptions = {
            id : {[model.Sequelize.Op.in]:orderIdList},
        };
        if(isAll == false) {
            orderOptions['active'] = ORDER_ALIVE.ACTIVE;
        }
        const orders = await OrderModel.findAll({
            where: orderOptions,
            include: [{
                model: model.OrderPlan,
                as: 'orderPlan',
                required: true,
            },{
                model: model.User,
                as: 'user',
                required: true,
            }]
        });
        return orders;
    }

    static async getOrderByCustomId(uKey) {
        const orderList = await OrderModel.findAll({
            where: {uKey: uKey},
            include: [{
                model: model['User'],
                as: 'user',
                required: true
            }, {
                model: model['OrderPlan'],
                as: 'orderPlan',
                required: true
            }]
        });
        return orderList[0];
    }

    static async getOrdersKeepAliveWithUserModel(orderPlanId) {
        const subOrders = await OrderModel.findAll({
            include: [{
                model: model['User'],
                required: true,
                as: 'user'
            }],
            where:{
                orderPlanId:orderPlanId,
                active: {[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED]},
            },
            order: [['updatedAt', 'DESC']],
        });
        return subOrders
    }

    async sendWatcherQueue() {
        await redisCtrl.setOrderDetail(this['dataValues']);
        await redisCtrl.setNewOrder(this['dataValues']);
        await this.loggingByStatus();
    }

    async sendOrderQueue() {
        await redisCtrl.pushQueue(`orderBot:queue`, `${this.id}=${this.indicatorType === 'OPEN' ? 'OPEN' : 'CLOSE'}`);
    }

    async loggingByStatus() {
        if(this.active === ORDER_ALIVE.ACTIVE) {
            if(this.status === 'WAITING') {
                await logger.info('ORDER','START', this, {execQty: this.execQty});
            }
        }
        else if(this.active === ORDER_ALIVE.STOP_BY_USER) {
            if(this.status === 'USER_CANCEL'){
                await logger.info('ORDER', 'CANCELED', this, 'userCancel');
            }
            await logger.info('ORDER', 'PAUSE', this, '-');
        }
        else if(this.active === ORDER_ALIVE.CANCELED) {
            if(this.status === 'USER_CANCEL') {
                await logger.info('ORDER','CANCELED', this,'userCancel');
            }
            else if(this.status === 'MODIFY_CANCEL') {
                await logger.info('ORDER','CANCELED', this,'modifyCancel');
            }
            else if(this.status === 'COMPLETE_CANCEL') {
                await logger.info('ORDER','CANCELED', this,'completeCancel');
            }
        }
        else if(this.active === ORDER_ALIVE.STOP_BY_ERROR) {
            await logger.info('ORDER', 'STOP', this, '-');
        }
    }

    async updateResult(exchangeOrderData) {
        switch (exchangeOrderData['status']) {
            case "FILLED":
                await this.updateFilled(exchangeOrderData);
                break;
            case "PARTIALLY_FILLED":
                await this.updateFilled(exchangeOrderData);
                break;
            case "NEW":
                await this.updateNew(exchangeOrderData);
                break;
        }
    }

    async updateNew(exchangeOrderData) {
        if(this.tradeType === 'Market') {
            return;
        }
        const queryString = `UPDATE "Orders" SET ` +
            `"status" = CASE WHEN "filledQty" > 0 THEN "status" ELSE '${(this.tradeType === 'Trail') ? "TRAILING" : "PENDING"}' END, ` +
            `"transactTime" = current_timestamp WHERE "id"='${this.id}'`;
        await model.sequelize.query(queryString);
        await this.reload();
    }

    async updateFilled(exchangeOrderData) {
        let queryString;
        if(exchangeOrderData['status'] === 'FILLED') {
            queryString = `UPDATE "Orders" SET "filledQty" = "filledQty" + ${exchangeOrderData['executedQty']}, ` +
                `"filledAmount" = "filledAmount" + ${exchangeOrderData['amount']}, ` +
                `"status" = 'COMPLETE', "active" = ${ORDER_ALIVE.COMPLETE},` +
                `"transactTime" = current_timestamp WHERE "id"='${this.id}'`;
        }
        else if(exchangeOrderData['status'] === 'PARTIALLY_FILLED') {
            queryString = `UPDATE "Orders" SET "filledQty" = "filledQty" + ${exchangeOrderData['executedQty']}, ` +
                `"filledAmount" = "filledAmount" + ${exchangeOrderData['amount']}, ` +
                `"status" = CASE WHEN "active"=-1 THEN 'COMPLETE' ELSE 'PARTIALLY_FILLED' END,` +
                `"transactTime" = current_timestamp WHERE "id"='${this.id}'`;
        }
        await model.sequelize.query(queryString);
        await this.reload();
        await model.Commission.makeNewCommissions(this.orderPlanId, exchangeOrderData.commission);
        const logContent = {
            filledPrice : exchangeOrderData.price,
            filledQty: exchangeOrderData.excuteQty,
            commission: JSON.stringify(exchangeOrderData.commission),
        };
        await logger.info('ORDER', exchangeOrderData.status, this, logContent);
    }


    async convertInfoForm(orderPlan) {
        const price = this.indicators[0]['enterPrice'] ? `${this.indicators[0].enterPrice}`
            : this.indicators[0]['takeProfitPercent'] ? `${(this.indicators[0].takeProfitPercent*100).toFixed(1)}%`
            : this.indicators[0]['stopLossPercent'] ? `${(this.indicators[0].stopLossPercent*100).toFixed(1)}%`: `-`;

        let qty = this.origQty;
        let qtyPercentage = 0;
        if(orderPlan.isCloseTypeAmount == true) {
            qty = this.execQty;
            qtyPercentage = this.origQty;
        }

        const result = {
            price: price,
            qty: qty,
            bundle: this.bundle,
            status: this.status
        };
        if(this.planType == 'basic') {
            result['tradeType'] = this.tradeType;
        }
        if(this.planType == 'trendLine' && this.indicatorType === 'OPEN') {
            result ['tradingStartPrice'] = this.indicators[0]['tradingStartPrice'];
            result ['tradingEndPrice'] = this.indicators[0]['tradingEndPrice'];
            result ['startDate'] = new Date(this.indicators[0]['startDate']).getTime();
            result ['endDate'] = new Date(this.indicators[0]['endDate']).getTime();
        }
        if(orderPlan.isCloseTypeAmount == true && this.indicatorType !== 'OPEN') {
            result['qtyPercentage'] = qtyPercentage;
        }
        return result;
    }

    convertTransactForm() {
        if(this.filledQty === 0) {
            return;
        }
        return {
            type: this.indicatorType,
            price: this.filledPrice,
            qty: this.filledQty,
            updatedAt: this.transactTime.getTime()
        }
    }

    async modify(orderInfo, isCloseTypeAmount) {
        this.origQty = orderInfo.qty;
        if(orderInfo.hasOwnProperty('execQty')) {
            this.execQty = orderInfo.execQty;
        }
        if(this.indicatorType === 'OPEN') {
            this.execQty = orderInfo.qty;
        }
        this.trailingValue = orderInfo.trailingValue ? orderInfo.trailingValue : 0;
        this.indicators = orderInfo.indicators;
        this.orderOptions = orderInfo.orderOptions;
        await logger.info('ORDER', 'MODIFY', this);
    }

    async canceledByTrigger() {
        this.active = ORDER_ALIVE.ACTIVE;
        this.status = 'WAITING';
        this.uKey = OrderModel.generateUKey(this.userId);
        await this.save();
    }

    async canceledByUser() {
        this.uKey = OrderModel.generateUKey(this.userId);
        await this.save();
    }

    async canceledByComplete() {
        this.active = ORDER_ALIVE.CANCELED;
        this.status = 'CANCELED';
        await this.save();
    }

    async rejectedStopByError() {
        this.active = ORDER_ALIVE.STOP_BY_ERROR;
        this.status = 'ERROR_STOP';
        this.uKey = OrderModel.generateUKey(this.userId);
        await this.save();
    }

    async endByTimeOver() {
        this.active = ORDER_ALIVE.COMPLETE;
        this.status = 'COMPLETE';
        await this.save();
    }



    get filledPrice(){
        return  this.filledAmount > 0 ?  (this.filledAmount * CONVERT_INTEGER_VALUE) / (this.filledQty * CONVERT_INTEGER_VALUE) : 0;
    }

    async convertTelegramForm(action) {
        if(!["COMPLETE", "PARTIALLY_FILLED"].includes(this.status)) return;
        if(!this.orderPlan){
            this['orderPlan'] = await model['OrderPlan'].findByPk(this.orderPlanId);
        }
        else{
            await this['orderPlan'].reload();
        }
        let isVirtual, indicatorType;
        isVirtual = REALITYTYPE_WORD_MAP[this.user.language][this.orderPlan.isVirtual ? 1 : 0];
        indicatorType = INDICATORTYPE_WORD_MAP[this.indicatorType][this.user.language];
        if(this.planType === 'strategy' && this.indicatorType !== 'OPEN'){
            indicatorType = INDICATORTYPE_WORD_MAP['CLOSE'][this.user.language]
        }
        const [base, quote] = this.symbol.split('-');
        const tickSize = await redisCtrl.getTickSize(this.exchange, this.symbol);
        const tickLength = `${Math.round(1 / parseFloat(tickSize))}`.length - 1;

        let rateOfReturn;

        if(this.indicatorType === 'OPEN' && this['orderPlan'].tradeCount > 2){
            rateOfReturn = this['orderPlan'].rateOfReturn(this.filledAmount, this.filledQty)
        }else{
            rateOfReturn = this['orderPlan'].rateOfReturn() === 0 ? '-' : this['orderPlan'].rateOfReturn()
        }


        const TelegramContentValue = {
            id: this.orderPlanId,
            timestamp: countryTimeDate(this.transactTime.getTime(), this.user.timezone),
            userName: this.user.userName,
            isVirtual: isVirtual,
            exchange: this.exchange,
            tradeType: this.tradeType,
            indicatorType: indicatorType,
            symbol: this.symbol,
            side: this.side,
            base: base,
            quote: quote,
            filledPrice: utils.floorTicker(tickSize, tickLength, this.filledPrice).toFixed(tickLength),
            filledQty: this.filledQty,
            strategyName: this['orderPlan'].strategyName,
            tradeCount:this['orderPlan'].tradeCount,
            rateReturn: rateOfReturn,
        };
        const code = `ORDER-${this.planType.toUpperCase()}-${action}`;
        return [code, TelegramContentValue];
    }

    makeExecuteOrderForm() {
        return [
            this.symbol,
            this.side,
            this.tradeType,
            this.indicators[0].hasOwnProperty('name') ? {} : this.indicators[0],
            this.uKey,
            this.execQty - this.filledQty,
            this.orderOptions
        ]
    }
}

module.exports = OrderModel;