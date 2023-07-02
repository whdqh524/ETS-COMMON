'use strict';

const { DataTypes, Deferrable } = require('sequelize');
const { BaseModel } = require('./base');
const model = require('./internal');

const tradeHistoryAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    userId: {type: DataTypes.UUID, allowNull: false, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    orderPlanId: {type: DataTypes.UUID, references: {model: 'OrderPlans', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}}, //FK
    orderId: {type: DataTypes.UUID, allowNull: false, references: {model: 'Orders', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}}, //FK
    orderType: {type: DataTypes.STRING(10), allowNull: false}, //Buy //Sell
    status: {type: DataTypes.STRING, allowNull: false},
    totalAmount: {type: DataTypes.FLOAT, allowNull: false, defaultValue: 0},
    price: {type: DataTypes.FLOAT, allowNull: false, defaultValue:0},
    origQty: {type: DataTypes.FLOAT, allowNull: false, defaultValue: 0},
    execQty: {type: DataTypes.FLOAT, allowNull: false, defaultValue: 0},
    message: {type: DataTypes.STRING},
    createDate: {type: DataTypes.DATE, defaultValue: new Date()},
    updateDate: {type: DataTypes.DATE}
};

class TradeHistoryModel extends BaseModel {
    constructor(...args) {
        super(...args);
}

    static initModel(sequelize) {
        TradeHistoryModel.init(tradeHistoryAttributes, {sequelize, modelName: 'TradeHistory', indexes: [{unique: false, fields: ['userId','orderPlanId','orderId']}]});
    }

    static relationModel() {
        TradeHistoryModel.belongsTo(model.User, {foreignKey:"userId"});
        TradeHistoryModel.belongsTo(model.OrderPlan, {foreignKey:"orderPlanId"});
        TradeHistoryModel.belongsTo(model.Order, {foreignKey:"orderId"});
        TradeHistoryModel.belongsTo(model.User, {foreignKey:"userId"});
    }

    static async makeNewPendingForm(orderData, currentPrice){
        let totalAmount=0, price=0, execQty=0;
        if(orderData.status === 'PENDING') {
            price = (orderData.indicators[0].hasOwnProperty('enterPrice' ) && orderData.indicators[0].enterPrice.length > 0)? orderData.indicators[0].enterPrice : currentPrice;
        }
        const orderForm = {
            userId: orderData.userId,
            orderPlanId: orderData.orderPlanId,
            orderId: orderData.id,
            orderType: orderData.planType,
            status: orderData.status,
            totalAmount: totalAmount,
            price: price,
            origQty: orderData.origQty,
            execQty: execQty
        };
        return TradeHistoryModel.build(orderForm);
    }

    static async makeNewComepleteForm(orderData, exchangeOrderData) {
        let totalAmount = 0;
        if(exchangeOrderData['avgPx'] && exchangeOrderData['cumQty']) {
            totalAmount = parseFloat(exchangeOrderData['avgPx']) * parseFloat(exchangeOrderData['cumQty']);
        }
        const orderForm = {
            userId: orderData.userId,
            orderPlanId: orderData.orderPlanId,
            orderId: orderData.id,
            orderType: orderData.planType,
            status: orderData.status,
            totalAmount: totalAmount,
            price: (exchangeOrderData['avgPx']) ? exchangeOrderData['avgPx'] : 0,
            origQty: orderData.origQty,
            execQty: (exchangeOrderData['cumQty']) ? exchangeOrderData['cumQty'] : 0
        };
        return TradeHistoryModel.build(orderForm);
    }
}

module.exports = TradeHistoryModel;