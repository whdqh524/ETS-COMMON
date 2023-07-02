'use strict';

const env = process.env.NODE_ENV || "development";
const config = require('../config');
const { DataTypes, Deferrable, Op } = require('sequelize');
const { BaseModel } = require('./base');
const { ORDER_ALIVE, COMPLETE_ORDER_LIMIT, CONVERT_INTEGER_VALUE, ONGOING_ORDER_LIMIT, REALITYTYPE_WORD_MAP} = require('../enum');
const model = require('./internal');
const redisCtrl = require('../modules/redisCtrl');
const calc = require('../modules/calc');
const { objectCompare, countryTimeDate, roundTicker, floorTicker } = require('../modules/utils');
const logger = require('../modules/logger');
const {
    NotOpenFilledActionError,
    OrderPlanNotExistError,
    NotAllowedCompletedOrderError,
    ParameterError,
    WrongDirectionError,
    OrderCountRestrictionError,
    SubOrderNotExistError,
    PauseActionOnlyActiveOrderError,
    ResumeActionOnlyPauseActiveError,
    EnterPriceTickSizeInvalidError } = require('../modules/error');


const orderPlanAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey:true},
    userId: {type: DataTypes.UUID, allowNull: false, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    active: {type: DataTypes.INTEGER, defaultValue: ORDER_ALIVE.ACTIVE, allowNull: false},
    exchange: {type: DataTypes.STRING(10), allowNull: false},
    symbol: {type: DataTypes.STRING(20), allowNull: false},
    planType: {type: DataTypes.STRING(10), allowNull: false},
    direction: {type: DataTypes.STRING(15), allowNull: false}, // LongToShort or ShortToLong
    isCloseTypeAmount: {type: DataTypes.BOOLEAN, defaultValue:false, allowNull:false},
    isVirtual: {type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false},
    buyOpenAmount: {type: DataTypes.FLOAT, defaultValue:0, allowNull:false},
    buyOpenExecuteQty: {type: DataTypes.FLOAT, defaultValue:0, allowNull: false},
    sellOpenAmount: {type: DataTypes.FLOAT, defaultValue:0, allowNull:false},
    sellOpenExecuteQty: {type: DataTypes.FLOAT, defaultValue:0, allowNull: false},
    buyCloseAmount: {type: DataTypes.FLOAT, defaultValue:0, allowNull: false},
    buyCloseExecuteQty: {type: DataTypes.FLOAT, defaultValue:0, allowNull: false},
    sellCloseAmount: {type: DataTypes.FLOAT, defaultValue:0, allowNull: false},
    sellCloseExecuteQty: {type: DataTypes.FLOAT, defaultValue:0, allowNull: false},
    strategyId: {type: DataTypes.UUID, allowNull: true, references: {model: 'Strategies', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    strategyName: {type: DataTypes.STRING, allowNull: true, defaultValue: ''},
    strategyQty: {type: DataTypes.FLOAT, allowNull: false, defaultValue:0},
    systemMessage: {type: DataTypes.STRING(100), allowNull: true, defaultValue: ''},
    tradeCount: {type: DataTypes.INTEGER, allowNull: false, defaultValue:0}
};


class OrderPlanModel extends BaseModel {
    constructor(...args) {
        super(...args);
        if(this.constructor.name == 'OrderPlan') {
            switch(this.planType) {
                case 'basic':
                    return new model.BasicOrderPlan(...args);
                    break;
                case 'trendLine':
                    return new model.TrendLineOrderPlan(...args);
                    break;
                case 'strategy':
                    return new model.StrategyOrderPlan(...args);
                    break;
                default:
                    return new model.DefaultOrderPlan(...args);
                    break;
            }
        }
        return this;
    }

    static initModel(sequelize) {
        OrderPlanModel.init(orderPlanAttributes, {
            sequelize,
            modelName: 'OrderPlan',
            indexes: [
                {
                    unique: false, fields: ['userId', 'isVirtual', 'active', 'planType', 'exchange', 'symbol']
                },
                {
                    fields:['isVirtual', 'direction']
                }]
        });
    }

    static relationModel() {
        OrderPlanModel.belongsTo(model.User, {foreignKey:"userId", as:'user'});
        OrderPlanModel.belongsTo(model.Strategy, {foreignKey:"strategyId", as:'strategy'});
        OrderPlanModel.hasMany(model.Order, {as: 'subOrders', foreignKey: "orderPlanId"});
        OrderPlanModel.hasMany(model.Commission, {as: 'commissions', foreignKey: "orderPlanId"});
    }


    static async getOrderPlanWithSubOrdersById(orderPlanId) {
        const orderPlan = await OrderPlanModel.findByPk(orderPlanId,{
            include: [{
                model: model['Order'],
                required: true,
                as: 'subOrders'
            },{
                model: model['User'],
                required: true,
                as: 'user'
            }, {
                model: model['Strategy'],
                as: 'strategy'
            }, {
                model: model['Commission'],
                as: 'commissions'
            }],
            order: [[{model: model['Order'], as: 'subOrders'}, 'bundle', 'ASC'], [{model: model['Order'], as: 'subOrders'}, 'indicatorType', 'ASC']]
        });
        return orderPlan;
    }

    static async getOrderPlanWithSubOrdersByUserId(userId, isVirtual = false) {
        const orderPlans = await OrderPlanModel.findAll({
            where:{userId: userId, isVirtual: isVirtual},
            include: [{
                model: model['Order'],
                as: 'subOrders'
            }, {
                model: model['Strategy'],
                as: 'strategy'
            }]
        });
        return orderPlans;
    }

    static async getCompleteOrderPlansByPlanTypeAndSymbol(userId, exchange, planType, symbol, lastDate, isVirtual=false){
        const parserDate = parseInt(lastDate);
        const time = new Date(parserDate);
        let updatedAtWhereQuery;
        updatedAtWhereQuery = parserDate === 0 ? {[model.Sequelize.Op.gt]: time} : {[model.Sequelize.Op.lt]: time};
        let options = {
            userId: userId,
            exchange: exchange,
            planType: planType,
            active: {[model.Sequelize.Op.in]: [ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED]},
            isVirtual: isVirtual,
            updatedAt: updatedAtWhereQuery
        };

        if (symbol) options = Object.assign(options,{symbol});
        const orderPlans = await OrderPlanModel.findAll({
            where: options,
            include: [{
                model: model['Order'],
                as: 'subOrders'
            },{
                model: model['Strategy'],
                as: 'strategy'
            },{
                model: model['Commission'],
                as: 'commissions'
            }],
            order: [
                ['updatedAt', 'DESC'],
                [{model: model['Order'], as: 'subOrders'}, 'bundle', 'ASC'],
                [{model: model['Order'], as: 'subOrders'}, 'indicatorType', 'ASC'],
            ],
            limit: COMPLETE_ORDER_LIMIT,
        });
        let isLoadMore = false;
        if(orderPlans.length === COMPLETE_ORDER_LIMIT) isLoadMore = true;

        const results = [];
        orderPlans.map(async (orderPlan) => {
            results.push(await orderPlan.convertMyOrderForm());
        });

        return [results, isLoadMore];
    }


    static async getAllOrderPlansByUserIdAndType(userId, exchange, orderPlanType='OPEN', isVirtual=false) {
        const activeOptions = (orderPlanType === 'OPEN') ? {[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED]}
                            : {[model.Sequelize.Op.in]:[ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED]};
        const orderPlans = await OrderPlanModel.findAll({
            where:{userId: userId, isVirtual: isVirtual, active: activeOptions, exchange: exchange},
            include: [{
                model: model['Strategy'],
                as: 'strategy'
            },{
                model: model['Commission'],
                as: 'commissions'
            }],
            // order:[[{model: model['Order'], as: 'subOrders'}, 'bundle', 'ASC'], [{model: model['Order'], as: 'subOrders'}, 'updatedAt', 'ASC']]
        });
        const results = [];
        for(const orderPlan of orderPlans) {
            if(orderPlan.planType !== 'strategy') {
                orderPlan['subOrders'] = await model['Order'].findAll({where:{orderPlanId:orderPlan.id},
                    order: [['bundle', 'ASC'], ['updatedAt', 'ASC']]
                });
            }
            const result = await orderPlan.convertMyOrderForm();
            results.push(result);
        }
        return results;
    }

    static async getModelWithTransactions(orderPlanId) {
        const orderPlan = await OrderPlanModel.findByPk(orderPlanId, {
            include:[{
                model: model['Order'],
                as: 'subOrders',
            }, {
                model: model['Strategy'],
                as: 'strategy'
            }, {
                model: model['Commission'],
                as: 'commissions'
            }],
            order: [[{model: model['Order'], as: 'subOrders'}, 'bundle', 'ASC'],[{model: model['Order'], as: 'subOrders'}, 'updatedAt', 'ASC']]
        });

        if(!orderPlan) {
            throw new OrderPlanNotExistError('getOrderDetail API OrderPlanModel undefined');
        }
        if(orderPlan.planType === 'strategy') {
            return await model['StrategyOrderPlan'].getModelWithTransactions(orderPlan)
        }

        const transactions = await orderPlan.getTransactions();

        const result = {
            transactions: transactions
        };
        return result;
    }

    static async checkExistOpposeDirectionOrderPlan(userId, planType, exchange, symbol, direction, isVirtual) {
        if(planType == 'basic') {
            return;
        }
        const otherDirection = direction === 'B2S' ? 'S2B' : 'B2S';
        const orderPlans = await OrderPlanModel.findAll({
            where:{
                userId: userId,
                isVirtual: isVirtual,
                active: ORDER_ALIVE.ACTIVE,
                planType: {[Op.not]:'basic'},
                exchange: exchange,
                symbol: symbol,
                direction: otherDirection
            }
        });
        if(orderPlans.length > 0) throw new WrongDirectionError(`${otherDirection} OrderPlan Activated`);

    }

    static async checkUserOrdersCount(user, exchange, isVirtual) {
        if(user.grade === 'tester') return;
        const orderPlanCount = await OrderPlanModel.count({
            where: {
                userId: user.id,
                active: ORDER_ALIVE.ACTIVE,
                exchange: exchange,
                isVirtual: isVirtual
            },
        });
        if (orderPlanCount >= ONGOING_ORDER_LIMIT) throw new OrderCountRestrictionError();
    }

    async getTransactions() {
        let subOrders = this['subOrders'];
        if(!subOrders) {
            subOrders = await model.Order.findAll({where:{orderPlanId:this.id}});
        }
        const results = [];
        subOrders.map(subOrder => {
            const transaction = subOrder.convertTransactForm();
            if(transaction) {
               results.push(transaction);
            }
        });
        return results;
    }

    async saveAndSendSubOrder(saveList=[], closeOrderList=[], cancelOrderList=[], watcherList=[]) {
        if(saveList.length > 0) {
            await Promise.all(saveList.map(async (order) => {
                await order.save();
                if(order['_options']['isNewRecord'] === true) await logger.info('ORDER','NEW', order);
            }));
        }
        if(watcherList.length > 0) {
            await Promise.all(watcherList.map(async (order) => {
                await order.sendWatcherQueue();
            }));
        }
        if(closeOrderList.length > 0) {
            const joinIdString = closeOrderList.join(',');
            await redisCtrl.pushQueue(`orderBot:queue`, `${joinIdString}=CLOSE`);
        }
        if(cancelOrderList.length > 0) {
            const joinIdString = cancelOrderList.join(',');
            await redisCtrl.pushQueue(`orderBot:queue`, `${joinIdString}=CANCEL`);
        }
    }

    static async makeNew(planType, exchange, orderPlanInfo, user) {
        if(planType == 'strategy') {
            return await model['StrategyOrderPlan'].makeNew(planType, exchange, orderPlanInfo, user);
        }
        const orderPlanForm = {
            userId: user.id,
            exchange: exchange,
            symbol: orderPlanInfo.symbol,
            planType: planType,
            direction: orderPlanInfo.direction
        };
        if(orderPlanInfo.isVirtual) {
            orderPlanForm.isVirtual = true;
        }
        if(orderPlanInfo.isCloseTypeAmount) {
            orderPlanForm.isCloseTypeAmount = true
        }
        const orderPlanModel = OrderPlanModel.build(orderPlanForm);
        await logger.info('ORDER','NEW', orderPlanModel, '-');
        return orderPlanModel;
    }

    async convertMyOrderForm () {
        const openInfos = [];
        const takeProfitInfos = [];
        const stopLossInfos = [];
        const marketCloseOrders = [];
        const commissionMap = {};

        this['subOrders'].map(async(subOrder) => {
            if(subOrder.status === 'MODIFY_CANCEL') {
                return;
            }
            const orderInfo = await subOrder.convertInfoForm(this);
            switch (subOrder.indicatorType) {
                case 'OPEN' :
                    openInfos.push(orderInfo);
                    break;
                case 'TAKE':
                    takeProfitInfos.push(orderInfo);
                    break;
                case 'LOSS' :
                    stopLossInfos.push(orderInfo);
                    break;
                case 'SELLMARKETNOW' :
                    marketCloseOrders.push(orderInfo);
                    break;
            }
        });
        this['commissions'].map((commissionModel) => {
            commissionMap[commissionModel.asset] = commissionModel.qty;
        });

        const result = {
            orderPlanId: this.id,
            isVirtual: this.isVirtual,
            isCloseTypeAmount: this.isCloseTypeAmount,
            createdAt: this.createdAt.getTime(),
            updatedAt: this.updatedAt.getTime(),
            symbol: this.symbol,
            planType: this.planType,
            active: this.active,
            direction: this.direction,
            exchange: this.exchange,
            openAmount: this.openAmount,
            openExecuteQty: this.openExecuteQty,
            closeAmount: this.closeAmount,
            closeExecuteQty: this.closeExecuteQty,
            openInfo: openInfos,
            takeProfitInfo: takeProfitInfos,
            stopLossInfo: stopLossInfos,
            commission: commissionMap,
            systemMessage: this.systemMessage
        };

        if(marketCloseOrders.length > 0) {
            result['marketCloseInfo'] = marketCloseOrders;
        }

        return result;
    }

    checkEnterPrice(orderPlanInfo, tickSize) {
        const allOrderInfos = orderPlanInfo['openInfo'].concat(orderPlanInfo['takeProfitInfo']).concat(orderPlanInfo['stopLossInfo']);
        for(const orderInfo of allOrderInfos) {
            const enterPrice = parseInt(Math.round(parseFloat(orderInfo['enterPrice']) * CONVERT_INTEGER_VALUE));
            const tickValue = parseInt(Math.round(parseFloat(tickSize) * CONVERT_INTEGER_VALUE));
            if(orderInfo['enterPrice'] && enterPrice % tickValue > 0) {
                throw new EnterPriceTickSizeInvalidError(`Price does not fit the ${orderPlanInfo.symbol} Ticksize.`);
            }
        }
    }

    makePriceIndicators(indicatorType, orderInfo, orderLimit, slippageInfo, tickSize, stepSize) {
        const result = [];
        if(!orderInfo.enterPrice) {
            throw new ParameterError('enterPrice');
        }
        if(!orderInfo.qty) {
            throw new ParameterError('qty');
        }
        const indicator = {
            enterPrice: parseFloat(orderInfo.enterPrice),
            triggerPrice: (this.isVirtual == true) ? parseFloat(orderInfo.enterPrice) :
                calc.triggerPrice(orderInfo.enterPrice, slippageInfo.slippage, orderLimit, orderInfo.side, tickSize),
            actualPrice: parseFloat(orderInfo.enterPrice),
            cancelPrice: calc.cancelPrice(orderInfo.enterPrice, slippageInfo.slippage, orderLimit, orderInfo.side, tickSize),
        };

        let trailingInfo = {};
        if(orderInfo['trailingVolume'] && orderInfo['trailingVolume'] > 0) {
            trailingInfo = {
                side: orderInfo.side,
                tradeType: 'Trail',
                indicatorType: 'TRAIL',
                qty: floorTicker(stepSize, 8, Math.round(orderInfo.qty * orderInfo['trailingVolume'] / 100)),
                trailingValue: orderInfo.trailingValue,
                indicators: [indicator],
                orderOptions: orderInfo.orderOptions,
                bundle: orderInfo.bundle ? orderInfo.bundle : 0
            };
        }

        if(!orderInfo['trailingVolume'] || orderInfo['trailingVolume'] < 100) {
            const info = {
                side: orderInfo.side,
                tradeType: orderLimit,
                indicatorType: indicatorType,
                qty: floorTicker(stepSize, 8,(orderInfo['trailingVolume'] && orderInfo['trailingVolume'] > 0) ?
                    orderInfo.qty - Math.round(orderInfo.qty * orderInfo['trailingVolume'] / 100) : orderInfo.qty),
                trailingValue: 0,
                indicators: [indicator],
                orderOptions: orderInfo.orderOptions,
                bundle: orderInfo.bundle ? orderInfo.bundle : 0
            };
            result.push(info);
        }
        if(Object.keys(trailingInfo).length > 0) {
            result.push(trailingInfo);
        }
        for(const order of result) {
            if(!order.qty || order.qty == 0) {
                throw new ParameterError(`${indicatorType}Qty`);
            }
        }
        return result;
    }

    makeStopLossIndicators(orderInfo, orderLimit, slippageInfo, tickSize, stepSize) {
        if(!orderInfo.qty) {
            throw new ParameterError(`StopLossOrderQty`);
        }
        if(orderInfo.enterPrice) {
            if(orderInfo.enterPrice <= 0) {
                throw new ParameterError(`StopLossEnterPrice`);
            }
        }
        const indicator = {
            enterPrice: parseFloat(orderInfo.enterPrice),
            triggerPrice: (this.isVirtual == true) ? parseFloat(orderInfo.enterPrice) :
                calc.triggerPrice(orderInfo.enterPrice, slippageInfo.slippage, orderLimit, orderInfo.side, tickSize),
            actualPrice: parseFloat(orderInfo.enterPrice),
            cancelPrice: calc.cancelPrice(orderInfo.enterPrice, slippageInfo.slippage, orderLimit, orderInfo.side, tickSize),
        };
        const result = {
            side: orderInfo.side,
            tradeType: orderLimit,
            indicatorType: 'LOSS',
            qty: floorTicker(stepSize, 8, orderInfo.qty),
            orderOptions: orderInfo.orderOptions,
            indicators: [indicator],
        };
        if(orderInfo.bundle) {
            result.bundle = orderInfo.bundle;
        }
        return result;
    }


    static getSellMarketNowOrderInfo(tradeType, qty, direction, bundle) {
        return {
            openInfo: [{
                side: direction == 'B2S' ? 'SELL' : 'BUY',
                tradeType: tradeType,
                indicatorType: "SELLMARKETNOW",
                qty: qty,
                orderOptions: {execInst:['Close']},
                indicators: [{enterPrice:0, qty:qty}],
                bundle: bundle
            }]
        };
    }

    async processSellNowMarket(qty) {
        let [pendingIdList, waitingList, newInfoList] = [[],[],[]];
        let subOrders = this.subOrders;
        if(!subOrders) {
            subOrders = await model['Order'].findAll({where: {orderPlanId:this.id, active:ORDER_ALIVE.ACTIVE}, order: [['updatedAt', 'DESC']],});
        }
        for(const subOrder of subOrders) {
            if(subOrder.status === 'PENDING' || subOrder.status === 'PARTIALLY_FILLED') {
                pendingIdList.push(subOrder.id);
            }
            else {
                waitingList.push(subOrder);
            }
        }
        const lastBundle = subOrders.length > 0 ? subOrders[0].bundle : 1;
        const newMarketOrderInfo = OrderPlanModel.getSellMarketNowOrderInfo('Market', qty, this.direction, lastBundle);
        const newMarketOrder = model['Order'].makeNew(this.userId, this.id, this.symbol, this.planType, newMarketOrderInfo.openInfo[0], qty);
        newInfoList.push(newMarketOrder['dataValues']);

        return [pendingIdList, waitingList, newInfoList];
    }

    async start(subOrderInfos, seqTransaction=null) {
        const [openInfos, takeProfitInfos, stopLossInfos] = subOrderInfos;
        const subOrderDatas = [];
        const subOrders = [];
        const sendWatcherOrders = [];
        let lastBundleNumber;
        for(const orderInfo of openInfos) {
            if(!lastBundleNumber) {
                lastBundleNumber = orderInfo.bundle;
            }
            const subOrder = await model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo, orderInfo.qty);
            if(lastBundleNumber && lastBundleNumber != orderInfo.bundle) {
                subOrder.active = ORDER_ALIVE.WAITING;
            }
            subOrderDatas.push(subOrder['dataValues']);
            subOrders.push(subOrder);
            sendWatcherOrders.push(subOrder);
        }

        for(const orderInfo of takeProfitInfos) {
            const subOrder = await model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo);
            subOrder.active = ORDER_ALIVE.WAITING;
            subOrderDatas.push(subOrder['dataValues']);
            subOrders.push(subOrder);
        }

        for(const orderInfo of stopLossInfos) {
            const subOrder = await model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo);
            subOrder.active = ORDER_ALIVE.WAITING;
            subOrderDatas.push(subOrder['dataValues']);
            subOrders.push(subOrder);
        }
        this['subOrders'] = subOrders;
        if(seqTransaction) {
            await model.Order.bulkCreate(subOrderDatas, {transaction:seqTransaction});
            await seqTransaction.commit();
        }
        else {
            await model.Order.bulkCreate(subOrderDatas);
        }
        await logger.info('ORDER','NEW', this['subOrders']);
        await Promise.all(sendWatcherOrders.map(async (subOrder) => {
            await subOrder.sendWatcherQueue();
        }));
    }

    async getSubOrderMap() {
        let subOrders = this['subOrders'];
        let subOrderCount = 0;
        if(!subOrders) {
            subOrders = await model.Order.findAll({where:{orderPlanId:this.id, active:{[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE,ORDER_ALIVE.CANCELED]}}});
        }
        const subOrderMap = {OPEN: [], TAKE: {}, LOSS: []};
        for(const subOrder of subOrders) {
            if(subOrder.active === ORDER_ALIVE.COMPLETE || subOrder.active === ORDER_ALIVE.CANCELED) {
                continue;
            }
            if(subOrder.status === 'PARTIALLY_FILLED' || subOrder.status === 'MODIFY_CANCEL') {
                continue;
            }
            if(subOrder.indicatorType === 'OPEN') {
                subOrderMap.OPEN.push(subOrder);
                subOrderCount++;
            }
            else if(subOrder.indicatorType === 'TAKE' || subOrder.indicatorType === 'TRAIL') {
                if(!subOrderMap.TAKE.hasOwnProperty(subOrder.bundle)) {
                    subOrderMap.TAKE[subOrder.bundle] = {}
                }
                subOrderMap.TAKE[subOrder.bundle][subOrder.indicatorType] = subOrder;
                subOrderCount++;
            }
            else if(subOrder.indicatorType === 'LOSS') {
                subOrderMap.LOSS.push(subOrder);
                subOrderCount++;
            }
            else if(subOrder.indicatorType === 'SELLMARKETNOW') {

            }
        }
        if(subOrders.length === 0 || subOrderCount == 0) throw new SubOrderNotExistError('Modify SubOrders Undefined');
        return subOrderMap;
    }

    async modifySubOrders(subOrderMap, openInfo, takeProfitInfo, stopLossInfo) {
        const saveList = [];
        const sendWatcherList = [];
        const cancelOrderBotList = [];
        const newOrderBotList = [];

        const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);
        let openSubOrder;
        if(subOrderMap.OPEN.length > 0) {
            openSubOrder = subOrderMap.OPEN[0];
            if(openSubOrder.origQty !== parseFloat(openInfo[0].qty) || !objectCompare(openSubOrder.indicators[0], openInfo[0].indicators[0])) {
                const currentPrice = await redisCtrl.getCurrentPrice(this.exchange, this.symbol);
                let newTradeType = 'Market';
                if(openInfo[0].indicators[0].enterPrice) {
                    const diffPrice = parseFloat(openInfo[0].indicators[0].enterPrice) - currentPrice;
                    if((diffPrice < 0 && openSubOrder.side === 'BUY') || (diffPrice > 0 && openSubOrder.side === 'SELL')) {
                        newTradeType = 'Limit';
                    }
                }
                const newCommand = (newTradeType == 'Market') ? ((openSubOrder.side === 'BUY') ? 'marketBuy' : 'marketSell') :
                    (openSubOrder.side === 'BUY') ? 'limitBuy' : 'limitSell';
                openSubOrder.tradeType = newTradeType;
                openSubOrder.command = newCommand;
                await openSubOrder.modify(openInfo[0]);
                saveList.push(openSubOrder);
                if(openSubOrder.active === ORDER_ALIVE.ACTIVE) {
                    if(openSubOrder.status === 'PENDING') {
                        openSubOrder.status = 'MODIFY_CANCEL';
                        openSubOrder.active = ORDER_ALIVE.CANCELED;
                        cancelOrderBotList.push(openSubOrder.id);
                        // const newOpenOrder = model['Order'].makeNew(this.userId, this.id, this.symbol, this.planType, openInfo[0], openInfo[0].qty);
                        // saveList.push(newOpenOrder);
                        // sendWatcherList.push(newOpenOrder);
                    }
                    else {
                        sendWatcherList.push(openSubOrder);
                    }
                }
            }
        }
        const newTakeInfoBundleMap = {};
        for(const takeInfo of takeProfitInfo) {
            if(!newTakeInfoBundleMap.hasOwnProperty(takeInfo.bundle)) {
                newTakeInfoBundleMap[takeInfo.bundle] = {};
            }
            newTakeInfoBundleMap[takeInfo.bundle][takeInfo.indicatorType] = takeInfo;
        }
        for(const bundle in newTakeInfoBundleMap) {
            const takeOrderInfo = newTakeInfoBundleMap[bundle]['TAKE'];
            const trailOrderInfo = newTakeInfoBundleMap[bundle]['TRAIL'];
            let takeSubOrder = (subOrderMap.TAKE[bundle] && subOrderMap.TAKE[bundle]['TAKE']) ? subOrderMap.TAKE[bundle]['TAKE'] : undefined;
            if(takeSubOrder) {
                if(takeOrderInfo) {
                    if(parseFloat(takeOrderInfo.qty) !== takeSubOrder.origQty || !objectCompare(takeOrderInfo.indicators[0], takeSubOrder.indicators[0])) {
                        if(this.isCloseTypeAmount == true) {
                            if(takeSubOrder.execQty > 0 && takeOrderInfo.indicators[0].enterPrice) {
                                takeOrderInfo['execQty'] = roundTicker(marketData['stepSize'], 8,
                                    this.openAmount / parseFloat(takeOrderInfo.indicators[0].enterPrice));
                            }
                        }
                        await takeSubOrder.modify(takeOrderInfo, this.isCloseTypeAmount);
                        saveList.push(takeSubOrder);
                        if(takeSubOrder.active === ORDER_ALIVE.ACTIVE) {
                            if(takeSubOrder.status === 'PENDING') {
                                takeSubOrder.status = 'MODIFY_CANCEL';
                                takeSubOrder.active = ORDER_ALIVE.CANCELED;
                                cancelOrderBotList.push(takeSubOrder.id);
                                // const newTakeSubOrder = model['Order'].makeNew(this.userId, this.id, this.symbol, this.planType, takeOrderInfo, takeOrderInfo.qty);
                                // saveList.push(newTakeSubOrder);
                                // sendWatcherList.push(newTakeSubOrder);
                            }
                            else {
                                sendWatcherList.push(takeSubOrder);
                            }

                        }
                    }
                }else {
                    takeSubOrder.status = 'MODIFY_CANCEL';
                    takeSubOrder.active = ORDER_ALIVE.CANCELED;
                    saveList.push(takeSubOrder);
                    if(takeSubOrder.status === 'PENDING') {
                        cancelOrderBotList.push(takeSubOrder.id);
                    }
                    else {
                        sendWatcherList.push(takeSubOrder);
                    }
                }
            }
            else {
                if(takeOrderInfo) {
                    const takeSubOrder = model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, takeOrderInfo, takeOrderInfo.qty);
                    saveList.push(takeSubOrder);
                    if(!subOrderMap.OPEN[0]) {
                        sendWatcherList.push(takeSubOrder);
                    }
                }
            }
            const trailSubOrder = (subOrderMap.TAKE[bundle] && subOrderMap.TAKE[bundle]['TRAIL']) ? subOrderMap.TAKE[bundle]['TRAIL'] : undefined;
            if(trailSubOrder) {
                if(trailOrderInfo) {
                    if(parseFloat(trailOrderInfo.qty) !== trailSubOrder.origQty || !objectCompare(trailOrderInfo.indicators[0], trailSubOrder.indicators[0])) {
                        if(this.isCloseTypeAmount == true) {
                            if(trailSubOrder.execQty > 0 && trailOrderInfo.indicators[0].enterPrice) {
                                trailOrderInfo['execQty'] = roundTicker(marketData['stepSize'], 8,
                                    this.openAmount / parseFloat(trailOrderInfo.indicators[0].enterPrice));
                            }
                        }
                        await trailSubOrder.modify(trailOrderInfo, this.isCloseTypeAmount);
                        saveList.push(trailSubOrder);
                        if(trailSubOrder.active == ORDER_ALIVE.ACTIVE) {
                            if(trailSubOrder.status === 'PENDING') {
                                trailSubOrder.status = 'MODIFY_CANCEL';
                                trailSubOrder.active = ORDER_ALIVE.CANCELED;
                                cancelOrderBotList.push(trailSubOrder.id);
                                // const newTrailSubOrder = model['Order'].makeNew(this.userId, this.id, this.symbol, this.planType, trailOrderInfo, trailOrderInfo.qty);
                                // saveList.push(newTrailSubOrder);
                                // sendWatcherList.push(newTrailSubOrder);
                            }
                            else if(trailSubOrder.status === 'WAITING' && trailSubOrder.active === ORDER_ALIVE.ACTIVE) {
                                sendWatcherList.push(trailSubOrder);
                            }
                        }
                    }
                }
                else {
                    trailSubOrder.status = 'MODIFY_CANCEL';
                    trailSubOrder.active = ORDER_ALIVE.CANCELED;
                    saveList.push(trailSubOrder);
                    if(trailSubOrder.status === 'PENDING') {
                        cancelOrderBotList.push(trailSubOrder.id);
                    }
                    else {
                        sendWatcherList.push(trailSubOrder);
                    }
                }
            }
            else {
                if(trailOrderInfo) {
                    const trailSubOrder = model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, trailOrderInfo, trailOrderInfo.qty);
                    saveList.push(trailSubOrder);
                    if(!subOrderMap.OPEN[0]) {
                        sendWatcherList.push(trailSubOrder);
                    }
                }
            }
        }
        if(subOrderMap.LOSS.length > 0) {
            const stopLossSubOrder = subOrderMap.LOSS[0];
            if(stopLossSubOrder.origQty !== parseFloat(stopLossInfo.qty) || !objectCompare(stopLossSubOrder.indicators[0], stopLossInfo.indicators[0])) {
                if(this.isCloseTypeAmount == true) {
                    if(stopLossSubOrder.execQty > 0 && stopLossInfo[0].indicators[0].enterPrice) {
                        stopLossInfo[0]['execQty'] = roundTicker(marketData['stepSize'], 8,
                            this.openAmount / parseFloat(stopLossInfo[0].indicators[0].enterPrice));
                    }
                }
                await stopLossSubOrder.modify(stopLossInfo[0], this.isCloseTypeAmount);
                saveList.push(stopLossSubOrder);
                if(stopLossSubOrder.active === ORDER_ALIVE.ACTIVE) {
                    sendWatcherList.push(stopLossSubOrder);
                }
            }
        }
        await this.saveAndSendSubOrder(saveList, newOrderBotList, cancelOrderBotList, sendWatcherList);

    }

    async pause() {
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`Pause NotAllowed Action OrderPlanActive=${this.active}`);
        if(this.active !== ORDER_ALIVE.ACTIVE) throw new PauseActionOnlyActiveOrderError();
        this.active = ORDER_ALIVE.STOP_BY_USER;
        await this.save();
        const subOrders = await model['Order'].getOrdersKeepAliveWithUserModel(this.id);
        if(subOrders.length == 0) throw new SubOrderNotExistError('Pause subOrders undefined');
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const subOrder of subOrders) {
            if(subOrder.active !== ORDER_ALIVE.ACTIVE) {
                continue;
            }
            if (subOrder.status == 'WAITING'){
                subOrder.active = ORDER_ALIVE.STOP_BY_USER;
                saveList.push(subOrder);
                watchList.push(subOrder);
            }
            else if(subOrder.status == 'PENDING' || subOrder.status == 'PARTIALLY_FILLED') {
                subOrder.active = ORDER_ALIVE.STOP_BY_USER;
                subOrder.status = 'USER_CANCEL';
                saveList.push(subOrder);
                cancelOrderList.push(subOrder.id);
            }
        }
        await logger.info('ORDER','PAUSE', this, '-');
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('PAUSE').catch(e => {});

    }

    static async pauseAll(user, exchange, isVirtual = true){
        const orderPlanModels = await OrderPlanModel.findAll({
            where:{
                userId: user.id, exchange: exchange, isVirtual: isVirtual,
                active: ORDER_ALIVE.ACTIVE
            }
        });

        const result = {
            successCount: 0,
            failedCount : 0
        };
        if(!orderPlanModels.length) return result;

        const promises = [];
        for(const orderPlanModel of orderPlanModels) {
            promises.push(orderPlanModel.pause());
        }
        return (await Promise.allSettled(promises)).reduce((acc, cur) => {
            const status = cur.status;
            if(status === 'fulfilled') {
                acc.successCount++;
            }
            else {
                acc.failedCount++;
            }
            return acc;
        }, result);
    }

    async resume() {
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) {
            throw new NotAllowedCompletedOrderError(`Resume NotAllowed Action OrderPlanActive=${this.active}`)
        }
        if(![ORDER_ALIVE.STOP_BY_ERROR, ORDER_ALIVE.STOP_BY_USER].includes(this.active)) {
            throw new ResumeActionOnlyPauseActiveError();
        }
        this.active = ORDER_ALIVE.ACTIVE;
        this.systemMessage = '';
        await this.save();
        const subOrders = await model['Order'].getOrdersKeepAliveWithUserModel(this.id);
        if(subOrders.length === 0) throw new SubOrderNotExistError('resume subOrders undefined');
        await logger.info('ORDER','RESUME', this, '-');
        await this.resumeSubOrders(subOrders);
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('RESUME').catch(e => {});

    }

    async resumeSubOrders(subOrders) {
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const subOrder of subOrders) {
            if (!(subOrder.active === ORDER_ALIVE.STOP_BY_USER || subOrder.active === ORDER_ALIVE.STOP_BY_ERROR)) {
                continue;
            }
            if(subOrder.indicatorType == 'OPEN' && subOrder.indicators[0]['enterPrice']) {
                const currentPrice = await redisCtrl.getCurrentPrice(this.exchange, this.symbol);
                const tradeType = subOrder.indicators[0]['enterPrice'] >= currentPrice ? 'Market' : 'Limit';
                subOrder.tradeType = tradeType;
            }
            if (subOrder.status == 'WAITING') {
                subOrder.active = ORDER_ALIVE.ACTIVE;
                saveList.push(subOrder);
                watchList.push(subOrder);
            } else if (subOrder.status == 'USER_CANCEL' || subOrder.status == 'ERROR_STOP') {
                subOrder.active = ORDER_ALIVE.ACTIVE;
                subOrder.status = 'WAITING';
                if(subOrder.filledQty > 0) {
                    subOrder.status = 'PARTIALLY_FILLED'
                }
                saveList.push(subOrder);
                if(this.isVirtual == false && subOrder.indicatorType === 'LOSS') {
                    closeOrderList.push(subOrder.id);
                }
                else {
                    watchList.push(subOrder);
                }
            }
        }
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
    }

    static async resumeAll(user, exchange, isVirtual = true){
        const orderPlanModels = await OrderPlanModel.findAll({
            where:{
                userId: user.id, exchange: exchange, isVirtual: isVirtual,
                active: {[model.Sequelize.Op.in]:[ORDER_ALIVE.STOP_BY_ERROR, ORDER_ALIVE.STOP_BY_USER]}
            },
            order: [['updatedAt', 'DESC']]
        });

        const result = {
            successCount: 0,
            failedCount : 0
        };

        if(!orderPlanModels.length) return result;

        for(const orderPlanModel of orderPlanModels){
            try{
                await OrderPlanModel.checkUserOrdersCount(user, exchange, isVirtual);
                await OrderPlanModel.checkExistOpposeDirectionOrderPlan(user.id, orderPlanModel.planType,
                    exchange, orderPlanModel.symbol, orderPlanModel.direction, orderPlanModel.isVirtual);
                await orderPlanModel.resume();
                result.successCount++;
            }catch(err){
                result.failedCount++;
            }
        }
        return result;
    }

    async cancel() {
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`Cancel NotAllowed Action OrderPlanActive=${this.active}`);
        this.active = ORDER_ALIVE.CANCELED;
        await this.save();
        await logger.info('ORDER', 'CANCEL', this,'userCancel');
        await this.cancelSubOrders();
        super.sendTelegramMessage('CANCEL').catch(e => {});
    }

    async cancelSubOrders() {
        const subOrders = await model['Order'].getOrdersKeepAliveWithUserModel(this.id);
        if(subOrders.length === 0) throw new SubOrderNotExistError('CancelSubOrders Undefined');
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const subOrder of subOrders) {
            const lastStatus = subOrder.status;
            const lastActive = subOrder.active;
            subOrder.status = 'USER_CANCEL';
            subOrder.active = ORDER_ALIVE.CANCELED;
            saveList.push(subOrder);
            if(lastActive === ORDER_ALIVE.ACTIVE) {
                if(lastStatus == 'WAITING') {
                    watchList.push(subOrder);
                }
                else if(lastStatus == 'PENDING' || lastStatus == 'PARTIALLY_FILLED') {
                    cancelOrderList.push(subOrder.id);
                }
            }
            else if (lastActive === ORDER_ALIVE.STOP_BY_USER){
                subOrder.active = ORDER_ALIVE.CANCELED;
                subOrder.status = 'USER_CANCEL';
            }

        }
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
    }

    static async cancelAllByUserIdAndAsset(user, exchange, base, quote, isVirtual = false){
        const symbolCondition = [];
        if(base) symbolCondition.push({[model.Sequelize.Op.like]:`${base}-%`});
        if(quote) symbolCondition.push({[model.Sequelize.Op.like]:`%-${quote}`});

        const orderPlanModels = await OrderPlanModel.findAll({
            where:{
                userId: user.id, exchange: exchange, isVirtual: isVirtual,
                active: {[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED]},
                symbol: {[model.Sequelize.Op.or]:symbolCondition},
            }
        });

        const result = {
            successCount : 0,
            failedCount : 0
        };
        if(!orderPlanModels.length) return result;

        const promises = [];
        for(const orderPlanModel of orderPlanModels) {
            promises.push(orderPlanModel.cancel());
        }
        return (await Promise.allSettled(promises)).reduce((acc, cur) => {
            const status = cur.status;
            if(status === 'fulfilled') {
                acc.successCount++;
            }
            else {
                acc.failedCount++;
            }
            return acc;
        }, result);
    }

    async sellMarketNow(){
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`SellMarketNow NotAllowed Action OrderPlanActive=${this.active}`);
        await logger.info('ORDER','SELLMARKETNOW', this, '-');
        const subOrders = await model['Order'].getOrdersKeepAliveWithUserModel(this.id);
        const lastBundle = subOrders.length > 0 ? subOrders[0].bundle : 1;
        const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);
        let differenceOrderQty = floorTicker(marketData['stepSize'], 8, this.openExecuteQty - this.closeExecuteQty);
        if(differenceOrderQty <= 0) throw new NotOpenFilledActionError('sellMarketNow openFilledQty equal to or less than zero ');
        if(this.isCloseTypeAmount == true) {
            const currentPrice = await redisCtrl.getCurrentPrice(this.exchange, this.symbol);
            differenceOrderQty = roundTicker(marketData['stepSize'], 8, this.openAmount / parseFloat(currentPrice));
        }

        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const subOrder of subOrders) {
            const lastStatus = subOrder.status;
            const lastActive = subOrder.active;
            subOrder.status = 'COMPLETE_CANCEL';
            subOrder.active = ORDER_ALIVE.CANCELED;
            saveList.push(subOrder);
            if(lastActive === ORDER_ALIVE.ACTIVE) {
                if(lastStatus == 'WAITING'){
                    watchList.push(subOrder);
                }
                else if (lastStatus == 'PENDING' || lastStatus == 'TRAILING'){
                    cancelOrderList.push(subOrder.id);
                }
            }
        }
        const orderInfo = OrderPlanModel.getSellMarketNowOrderInfo('Market', differenceOrderQty, this.direction, lastBundle);
        const sellMarketOrder = await model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo.openInfo[0], orderInfo.openInfo[0].qty);
        saveList.push(sellMarketOrder);
        closeOrderList.push(sellMarketOrder.id);
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
    }

    async processCompleteSubOrder(order) {
        switch(order.indicatorType) {
            case 'OPEN':
                await this.processCompleteOpenOrder(order);
                break;
            case 'LOSS':
                await this.processCompleteStopLossOrder(order);
                break;
            case 'TAKE':
                await this.processCompleteTakeProfitOrder(order);
                break;
            case 'TRAIL':
                await this.processCompleteTakeProfitOrder(order);
                break;
            case 'SELLMARKETNOW':
                await this.processCompleteSellNowMarketOrder(order);
                break;
        }
        await logger.infoConsole(`${order.indicatorType}:${this.direction}:${order.side}`, order);
    }

    async processPartialSubOrder(order) {
        if(order.indicatorType !== 'OPEN') {
            return;
        }
        await this.processCompleteOpenOrder(order);
    }

    async processCompleteTakeProfitOrder(order) {
        const user = order['user'];
        const takeProfitOrders = await model.Order.findAll({
            where:{
                orderPlanId:this.id,
                active: {[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED]},
                indicatorType: {[model.Sequelize.Op.in]:['TAKE','TRAIL']}
            },
            order: [['bundle', 'ASC'], ['indicatorType', 'ASC']]
        });
        if(takeProfitOrders.length === 0) {
            const stopLossOrders = await model.Order.findAll({where:{orderPlanId:this.id, indicatorType:'LOSS'}});
            const stopLossOrder = stopLossOrders[0];
            stopLossOrder.active = ORDER_ALIVE.CANCELED;
            stopLossOrder.status = 'COMPLETE_CANCEL';
            await stopLossOrder.save();
            await stopLossOrder.sendWatcherQueue();
            this.active = ORDER_ALIVE.COMPLETE;
            await this.save();
            await this.inputTradingContestRecord(user);
        }
        else {
            const stopLossOrders = await model.Order.findAll({where:{orderPlanId:this.id, indicatorType:'LOSS'}});
            const stopLossOrder = stopLossOrders[0];
            const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);
            stopLossOrder.execQty = floorTicker(marketData['stepSize'], 8, this.openExecuteQty - this.closeExecuteQty);
            await stopLossOrder.save();
            await stopLossOrder.sendWatcherQueue();
        }
        await logger.info('ORDER', 'END', this, '-');
    }

    async processCompleteStopLossOrder(order) {
        const user = order['user'];
        const closeOrders = await model.Order.findAll({
            where: {
                orderPlanId:this.id,
                active: ORDER_ALIVE.ACTIVE,
                indicatorType:{[model.Sequelize.Op.in]:['TAKE','TRAIL']}
            }
        });
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const closeOrder of closeOrders) {
            const lastStatus = closeOrder.status;
            closeOrder.active = ORDER_ALIVE.CANCELED;
            closeOrder.status = 'COMPLETE_CANCEL';
            saveList.push(closeOrder);
            if(lastStatus === 'WAITING') {
                watchList.push(closeOrder);
            }
            else if(lastStatus === 'PENDING') {
                cancelOrderList.push(closeOrder.id);
            }
        }
        this.active = ORDER_ALIVE.COMPLETE;
        await this.save();
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        await this.inputTradingContestRecord(user);
        await logger.info('ORDER', 'END', this, '-');
    }

    async processCompleteSellNowMarketOrder(order) {
        this.active = ORDER_ALIVE.COMPLETE;
        await this.save();
        const user = order['user'];
        await this.inputTradingContestRecord(user);
        await logger.info('ORDER', 'END', this, '-');
    }

    async updateSummary(prevOrderData, exchangeOrderData) {
        let plusAmount = exchangeOrderData.amount;
        let plusQty = exchangeOrderData.executedQty;
        if(exchangeOrderData['status'] === 'FILLED' || exchangeOrderData['status'] === 'PARTIALLY_FILLED') {
            if(prevOrderData.indicatorType === 'OPEN') {
                if(prevOrderData.side === 'BUY') {
                    await this.increment({'buyOpenAmount':plusAmount, 'buyOpenExecuteQty':plusQty});
                }else {
                    await this.increment({'sellOpenAmount':plusAmount, 'sellOpenExecuteQty':plusQty});
                }
            }
            else{
                if(prevOrderData.side === 'BUY') {
                    await this.increment({'buyCloseAmount':plusAmount, 'buyCloseExecuteQty':plusQty});
                }
                else {
                    await this.increment({'sellCloseAmount':plusAmount, 'sellCloseExecuteQty':plusQty});
                }
            }
        }
        if(exchangeOrderData['status'] === 'FILLED') {
            await this.increment({'tradeCount':1});
        }
        await this.reload();
    }

    get openAmount() {
        return (this.direction === 'B2S') ? this.buyOpenAmount : (this.direction === 'S2B') ? this.sellOpenAmount : this.buyOpenAmount + this.sellOpenAmount;
    }
    get openExecuteQty() {
        return (this.direction === 'B2S') ? this.buyOpenExecuteQty : (this.direction === 'S2B') ? this.sellOpenExecuteQty : this.buyOpenExecuteQty + this.sellOpenExecuteQty;
    }
    get closeAmount() {
        return (this.direction === 'B2S') ? this.sellCloseAmount : (this.direction === 'S2B') ? this.buyCloseAmount : this.buyCloseAmount + this.sellCloseAmount;
    }
    get closeExecuteQty() {
        return (this.direction === 'B2S') ? this.sellCloseExecuteQty : (this.direction === 'S2B') ? this.buyCloseExecuteQty : this.buyCloseExecuteQty + this.sellCloseExecuteQty;
    }

    rateOfReturn(minusOpenAmount = 0, minusOpenQty = 0) {
        let result = 0;
        if(this.closeExecuteQty > 0){
            const openPrice = (this.openAmount - minusOpenAmount) / (this.openExecuteQty - minusOpenQty);
            const closePrice = this.closeAmount / this.closeExecuteQty;
            result =  parseFloat(((closePrice - openPrice) / openPrice * 100).toFixed(2)) *  ((this.direction === 'B2S') ? 1 : -1);
        }
        return result;
    }

    get amountOfReturn() {
        let result = 0;
        if(this.closeAmount > 0) {
            result = (this.closeAmount - this.openAmount) * ((this.direction === 'B2S') ? 1 : -1);
        }
        return result;
    }

    async processExchangeErrorRaise(errorCode) {
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];

        this.active = ORDER_ALIVE.STOP_BY_ERROR;
        this.systemMessage = errorCode;
        await this.save();
        const subOrders = await model.Order.findAll({
            where:{
                orderPlanId: this.id,
                active: {[model.Sequelize.Op.eq]:[ORDER_ALIVE.ACTIVE]},
            },
        });
        for(let subOrder of subOrders){
            if(subOrder.indicatorType === 'LOSS') {
                if(this.openExecuteQty - this.closeExecuteQty > 0) {
                    continue;
                }
            }
            subOrder.active = ORDER_ALIVE.STOP_BY_ERROR;
            if(subOrder.status == 'PENDING') {
                cancelOrderList.push(subOrder.id)
            }
            subOrder.status = 'ERROR_STOP';
            watchList.push(subOrder);
            saveList.push(subOrder);
        }
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        await logger.info('ORDER','STOP', this,{errorMessage: this.systemMessage});
    }

    async processUnknownCancelRaise() {
        this.active = ORDER_ALIVE.STOP_BY_ERROR;
        this.systemMessage ='EX_INVALID_UNKNOWN';
        const subOrderList = await model.Order.findAll({where:{orderPlanId: this.id, active: ORDER_ALIVE.ACTIVE}});
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];

        for(const subOrder of subOrderList) {
            subOrder.active = ORDER_ALIVE.STOP_BY_ERROR;
            if(subOrder.status == 'PENDING' || subOrder.indicatorType == 'TRAIL') {
                cancelOrderList.push(subOrder.id);
            }
            subOrder.status = 'ERROR_STOP';
            watchList.push(subOrder);
            saveList.push(subOrder);
        }
        await this.save();
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        await logger.info('ORDER','STOP',this,'-')
    }

    async processEnd() {
        this.active = ORDER_ALIVE.COMPLETE;
        const subOrderList = await model.Order.findAll({where:{orderPlanId: this.id, active: ORDER_ALIVE.ACTIVE}});
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const subOrder of subOrderList) {
            subOrder.active = ORDER_ALIVE.COMPLETE;
            subOrder.status = 'COMPLETE';
            saveList.push(subOrder);
            if(subOrder.status === 'PENDING') {
                cancelOrderList.push(subOrder.id);
            }
            else {
                watchList.push(subOrder);
            }
        }
        await this.save();
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
    }


    async convertTelegramForm(action){
        const isVirtual = REALITYTYPE_WORD_MAP[this.user.language][this.isVirtual ? 1 : 0];
        const content = {
                timestamp: countryTimeDate(new Date().getTime(), this.user.timezone),
                userName: this.user.userName,
                planType: this.planType,
                symbol: this.symbol,
                id: this.id,
                exchange: this.exchange,
                isVirtual: isVirtual,
        };
        const code =  action === 'ERROR' ? 'ORDERPLAN-ALL-ERROR' : `ORDERPLAN-ALL-${action}`;
        return [code, content];
    }

    async inputTradingContestRecord(user) {
        if(this.direction === 'S2B') {
            return;
        }
        const tradingContests = await model['TradingContest'].getOngoingTradingContests();
        for(const tradingContest of tradingContests) {
            if(tradingContest.contestType === 'BestRateOfReturn' && this.rateOfReturn > 0) {
                await tradingContest.recordTradingByBestRateOfReturn(user, this.exchange, this.rateOfReturn);
            }
            else if(tradingContest.contestType === 'TotalRateOfReturn') {
                await tradingContest.recordTradingByTotalRateOfReturn(user, this.exchange, this.symbol, this.amountOfReturn);
            }
        }
    }
}

module.exports = OrderPlanModel;