'use strict';

const { DataTypes, Deferrable, literal } = require('sequelize');
const BaseModel = require('./base').BaseModel;
const model = require('./internal');

const receiptAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    userId: {type: DataTypes.UUID, allowNull:false, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    orderPlanId: {type: DataTypes.UUID, references: {model: 'OrderPlans', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    orderId: {type: DataTypes.UUID, references: {model: 'Orders', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    content: {type: DataTypes.JSON, defaultValue: {}, get(){return JSON.parse(this.getDataValue('content'))}},
    exchange: {type: DataTypes.STRING(10), allowNull: false},
    isVirtual: {type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false},
};

class ReceiptModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        ReceiptModel.init(receiptAttributes, {sequelize, modelName: 'Receipt', indexes:[{unique: false, fields:['userId']}, {unique: false, fields:['orderPlanId']}, {unique: false, fields:['userId', 'exchange', 'isVirtual']}]});
    }

    static relationModel() {
        ReceiptModel.belongsTo(model.User, {foreignKey:"userId"});
        ReceiptModel.belongsTo(model.OrderPlan, {foreignKey:"orderPlanId"});
        ReceiptModel.belongsTo(model.Order, {as: 'order', foreignKey:"orderId"});
    }

    static async getReceiptsByUserIdWithPagination(userId, startDate, endDate, pageSize, pageNumber, exchange, isVirtual, symbol) {
        const offset = ((pageNumber - 1) * pageSize);
        const orderCondition = {};
        if(symbol) orderCondition.symbol = symbol;

        const receipts = await ReceiptModel.findAndCountAll({
            where: {
                userId,
                exchange,
                isVirtual,
                createdAt: {[model.Sequelize.Op.between]: [startDate, endDate]}
            },
            offset: offset,
            limit: pageSize,
            include: [{
                model: model['Order'],
                as: 'order',
                where: orderCondition,
                attributes:[
                    'symbol', 'side', 'tradeType'
                ]
            }],
            order: [['createdAt', 'DESC']],
            attributes:[
                'content',
                'createdAt'
            ]
        })

        return {count:receipts.count, data: receipts.rows.map(receipt => receipt.convertReceiptsFormWithOrder())};
    }

    convertReceiptsFormWithOrder(){
        const content = this.content;
        const order = this.order;
        const result = {
            symbol: content.symbol || order.symbol,
            transactTime: parseInt(content.transactTime || this.createdAt.getTime()),
            status: content.status,
            type: content.type || (order.tradeType === 'Market' ? 'MARKET' : 'LIMIT'),
            side: content.side || order.side,
            filledPrice: content.price || 0,
            filledQty: content.executedQty || 0,
            filledAmount: content.amount || 0,
        }
        return result;
    }

}

module.exports = ReceiptModel;