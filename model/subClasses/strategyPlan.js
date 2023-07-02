'use strict';

const model = require('../internal');
const redisCtrl = require('../../modules/redisCtrl');
const calc = require('../../modules/calc');
const config = require('../../config');
const logger = require('../../modules/logger');
const { ORDER_ALIVE, CONVERT_INTEGER_VALUE } = require('../../enum');
const { Op } = require('sequelize');
const { countryTimeDate, floorTicker } = require('../../modules/utils');
const { NotOpenFilledActionError, ParameterError, StrategyNotExistError, NotAllowedCompletedOrderError } = require('../../modules/error');

class StrategyOrderPlan extends model.OrderPlan {
    constructor(...args) {
        super(...args);
    }

    static async makeNew(planType, exchange, orderPlanInfo, user) {
        if(!orderPlanInfo.strategyId) throw new ParameterError(`strategyId`);
        if(!orderPlanInfo.qty || parseFloat(orderPlanInfo.qty) <= 0) throw new ParameterError(`qty`);
        const marketData = await redisCtrl.getMarketData(exchange, orderPlanInfo.symbol);
        const orderPlanForm = {
            userId: user.id,
            exchange: exchange,
            symbol: orderPlanInfo.symbol,
            planType: planType,
            direction: orderPlanInfo.direction,
            strategyId : orderPlanInfo.strategyId,
            strategyQty : floorTicker(marketData['stepSize'], 8, parseFloat(orderPlanInfo.qty))
        };
        if(orderPlanInfo.isVirtual) {
            orderPlanForm.isVirtual = true;
        }
        if(orderPlanInfo.isCloseTypeAmount) {
            orderPlanForm.isCloseTypeAmount = true;
        }
        const orderPlanModel = StrategyOrderPlan.build(orderPlanForm);
        await logger.info('ORDER', 'NEW', orderPlanModel, '-');
        return orderPlanModel;
    }

    async convertMyOrderForm() {
        return {
            orderPlanId: this.id,
            isVirtual: this.isVirtual,
            isCloseTypeAmount: this.isCloseTypeAmount,
            createdAt: this.createdAt.getTime(),
            updatedAt: this.updatedAt.getTime(),
            symbol: this.symbol,
            planType: this.planType,
            strategyId: this.strategyId,
            strategyName: this.strategyName,
            strategyQty: this.strategyQty,
            active: this.active,
            direction: this.direction,
            exchange:  this.exchange,
            openAmount: this.openAmount,
            openExecuteQty: this.openExecuteQty,
            closeAmount: this.closeAmount,
            closeExecuteQty: this.closeExecuteQty,
            tradeCount: this.tradeCount,
            systemMessage: this.systemMessage
        }
    }

    static async getModelWithTransactions(orderPlan) {
        let strategyModel = orderPlan.strategy;
        if(!strategyModel) {
            strategyModel = await model['Strategy'].findByPk(this.strategyId);
        }
        const strategyInfo = strategyModel.convertReturnForm();
        const [transactions, openCount, closeCount, commissionMap] = await orderPlan.getTransactions();

        const result = {
            orderPlanId: this.id,
            strategyId: this.strategyId,
            symbol: this.symbol,
            name: orderPlan.strategyName,
            startDate: orderPlan.createdAt.getTime(),
            direction: orderPlan.direction,
            openCount: openCount,
            closeCount: closeCount,
            openInfo: strategyInfo.openInfo,
            takeProfitInfo: strategyInfo.takeProfitInfo,
            stopLossInfo: strategyInfo.stopLossInfo,
            trailingInfo: strategyInfo.trailingInfo,
            commission: commissionMap,
            transactions: transactions
        };
        return result;
    }

    async getTransactions() {
        let subOrders = this['subOrders'];
        if(!subOrders) {
            subOrders = await model.Order.findAll({where:{orderPlanId:this.id}});
        }
        let commissions = this['commissions'];
        if(!commissions) {
            commissions = await model.Commission.findAll({where:{orderPlanId:this.id}});
        }
        let bundleMap = {};
        const commissionMap = {};
        for(const subOrder of subOrders) {
            if(subOrder.active !== ORDER_ALIVE.ACTIVE && subOrder.active !== ORDER_ALIVE.COMPLETE) {
                continue;
            }
            if(!bundleMap.hasOwnProperty(subOrder.bundle)) {
                bundleMap[subOrder.bundle] = {
                    bundle: subOrder.bundle,
                    direction: 'B2S',
                    OPEN: {
                        updatedAt: 0,
                        filledQty: 0,
                        filledAmount: 0,
                        avgPrice: 0
                    },
                    CLOSE: {
                        updatedAt: 0,
                        filledQty: 0,
                        filledAmount: 0,
                        avgPrice: 0
                    }
                }
            }
            const subOrderIndicatorType = (subOrder.indicatorType === 'OPEN') ? 'OPEN' : 'CLOSE';
            bundleMap[subOrder.bundle][subOrderIndicatorType].updatedAt = subOrder.transactTime ? subOrder.transactTime.getTime() : 0;
            bundleMap[subOrder.bundle][subOrderIndicatorType].filledQty = bundleMap[subOrder.bundle][subOrderIndicatorType].filledQty + subOrder.filledQty;
            bundleMap[subOrder.bundle][subOrderIndicatorType].filledAmount = bundleMap[subOrder.bundle][subOrderIndicatorType].filledAmount + subOrder.filledAmount;
            bundleMap[subOrder.bundle][subOrderIndicatorType].avgPrice = bundleMap[subOrder.bundle][subOrderIndicatorType].filledAmount / bundleMap[subOrder.bundle][subOrderIndicatorType].filledQty;
            if(subOrder.indicatorType === 'OPEN' &&subOrder.side === 'SELL') {
                bundleMap[subOrder.bundle].direction = 'S2B';
            }
        }
        const bundleList = Object.values(bundleMap).filter((bundleInfo) => {
            return bundleInfo['OPEN']['filledQty'] > 0;
        });
        const transactions = (this.direction !== 'CROSS') ? bundleList.sort((a,b) => {return a.bundle - b.bundle})
            : bundleList.sort((a,b) => {
                if(a['OPEN'].updatedAt > b['OPEN'].updatedAt) {
                    return 1;
                }
                else if(a['OPEN'].updatedAt < b['OPEN'].updatedAt) {
                    return -1;
                }
                else if(a['CLOSE'].updatedAt > b['CLOSE'].updatedAt) {
                    return 1;
                }
                return a.OPEN.updatedAt - b.OPEN.updatedAt
            });

        let openCount = transactions.length, closeCount = transactions.length;

        if(transactions.length > 0 && transactions[transactions.length-1]['CLOSE']['filledQty'] === 0 && closeCount !== 0) {
            closeCount -= 1;
        }
        for(const commission of commissions) {
            commissionMap[commission.asset] = commission.qty;
        }
        return [transactions, openCount, closeCount, commissionMap];
    }

    async makeSubOrderInfos(orderPlanInfo, bundle=1) {
        const strategyModel = await model.Strategy.findByPk(orderPlanInfo.strategyId);
        this.direction = strategyModel.direction;
        this.strategyName = strategyModel.name;
        const openInfoList = this.makeOpenIndicators(strategyModel.openInfo, bundle);
        const takeProfitInfoList = this.makeTakeProfitIndicators(strategyModel.takeProfitInfo, strategyModel.trailingInfo, bundle);
        const stopLossInfoList = this.makeStopLossIndicators(strategyModel.stopLossInfo, bundle);
        return [openInfoList, takeProfitInfoList, stopLossInfoList];
    }

    makeOpenIndicators(orderInfos, bundle) {
        const openIndicators = [];
        for(const orderInfo of orderInfos) {
            openIndicators.push({
                side: orderInfo.side,
                tradeType: "Market",
                indicatorType: "OPEN",
                indicators: orderInfo.indicators,
                orderOptions: orderInfo.orderOptions,
                qty: this.strategyQty,
                bundle: bundle
            });
        }
        return openIndicators;
    }

    makeTakeProfitIndicators(orderInfos, trailingInfo, bundle) {
        const takeProfitInfoList = [];
        let trailingOrder = null;
        let trailingQty = 0;
        if(trailingInfo['trailingVolume'] && trailingInfo['trailingVolume'] > 0) {
            trailingQty = this.strategyQty;
            trailingOrder = {
                side: trailingInfo.side,
                tradeType: "Trail",
                indicatorType: "TRAIL",
                indicators: [{"takeProfitPercent":0}],
                orderOptions: {},
                qty: trailingQty,
                trailingValue: trailingInfo['trailingValue'],
                bundle: bundle
            };
        }
        for(const orderInfo of orderInfos) {
            if(trailingOrder) {
                trailingQty = Math.round(orderInfo.qty * trailingInfo['trailingVolume'] / 100);
                trailingOrder.qty = trailingQty;
            }
            if(orderInfo.indicators.length > 0) {
                let takeProfitTradeType = "Market";
                takeProfitTradeType = (orderInfo.indicators[0].hasOwnProperty('takeProfitPercent')) ? 'TakeProfitLimit' : "Market";
                takeProfitInfoList.push({
                    side: orderInfo.side,
                    tradeType: takeProfitTradeType,
                    indicatorType: "TAKE",
                    indicators: orderInfo.indicators,
                    orderOptions: orderInfo.orderOptions,
                    qty: this.strategyQty - trailingQty,
                    bundle: bundle
                });
            }
        }
        if(trailingOrder) {
            takeProfitInfoList.push(trailingInfo);
        }
        return takeProfitInfoList;
    }

    makeStopLossIndicators(stopLossInfo, bundle) {
        const stopLossInfoList = [];

        if(Object.keys(stopLossInfo).length > 0) {
            stopLossInfoList.push({
                side: (this.direction === 'B2S') ? "SELL" : "BUY",
                tradeType: 'Market',
                indicatorType: 'LOSS',
                indicators: stopLossInfo,
                qty: this.strategyQty,
                bundle: bundle
            });
        }
        return stopLossInfoList;
    }

    async start(subOrderInfos, seqTransaction=null) {
        const [openInfos, takeProfitInfos, stopLossInfos] = subOrderInfos;
        const subOrderDatas = [];
        const subOrders = [];
        const sendWatcherOrders = [];

        for(const orderInfo of openInfos) {
            const subOrder = model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo, orderInfo.qty);
            subOrderDatas.push(subOrder['dataValues']);
            subOrders.push(subOrder);
            sendWatcherOrders.push(subOrder);
            await logger.logToDatabase('STRATEGY','',
                {userId: this.userId, orderPlanId: this.id, indicators: orderInfo.indicators, side: orderInfo.side, isVirtual: this.isVirtual, exchange: this.exchange},'');
        }
        for(const orderInfo of takeProfitInfos) {
            const subOrder = model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo, orderInfo.qty);
            if(this.direction === 'CROSS') {
                sendWatcherOrders.push(subOrder);
            }
            else {
                subOrder.active = ORDER_ALIVE.WAITING;
            }
            subOrderDatas.push(subOrder['dataValues']);
            subOrders.push(subOrder);
            await logger.logToDatabase('STRATEGY','',
                {userId: this.userId, orderPlanId: this.id, indicators: orderInfo.indicators, side: orderInfo.side, isVirtual: this.isVirtual, exchange: this.exchange},'');
        }
        for(const orderInfo of stopLossInfos) {
            const subOrder = model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, orderInfo, orderInfo.qty);
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
        await logger.info('ORDER', 'NEW', this['subOrders']);
        await Promise.all(sendWatcherOrders.map(async (subOrder) => {
            await subOrder.sendWatcherQueue();
        }));

    }

    async modify(orderPlanInfo) {
        if(!this.strategyId) throw new StrategyNotExistError(`Modify StrategyId Not Exist`);
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`Strategy Order Modify NotAllowed Action OrderPlanActive=${this.active}`);
        if(!orderPlanInfo.qty || parseFloat(orderPlanInfo.qty) <= 0) throw new ParameterError(`strategyQty`);
        const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);
        this.strategyQty = floorTicker(marketData['stepSize'], 8, parseFloat(orderPlanInfo.qty));
        await this.save();
        await logger.info('ORDER','MODIFY', this, {strategyQty: this.strategyQty});
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('MODIFY').catch(e => {});
    }

    async resume() {
        if(!this.strategyId) throw new StrategyNotExistError(`Resume StrategyId Not Exist`);
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`Strategy Order Resume NotAllowed Action OrderPlanActive=${this.active}`);
        this.active = ORDER_ALIVE.ACTIVE;
        this.systemMessage = '';
        await this.save();
        await logger.info('ORDER','RESUME', this, '-');
        const subOrders = await model['Order'].getOrdersKeepAliveWithUserModel(this.id);
        if(subOrders.length > 0) {
            await super.resumeSubOrders(subOrders);
        }
        else {
            const allSubOrders = await model['Order'].findAll({where:{orderPlanId:this.id}, order:[['bundle', 'DESC']]});
            const lastBundle = allSubOrders[0].bundle;
            const subOrderInfos = await this.makeSubOrderInfos({strategyId:this.strategyId}, lastBundle);
            await this.start(subOrderInfos);
        }
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('RESUME').catch(e => {});
    }

    async cancel() {
        if(!this.strategyId) throw new StrategyNotExistError('Cancel StrategyId Not Exist');
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`Strategy Order Cancel NotAllowed Action OrderPlanActive=${this.active}`);
        this.active = ORDER_ALIVE.COMPLETE;
        if(this.closeAmount == 0) {
            this.active = ORDER_ALIVE.CANCELED;
        }
        await this.save();
        await this.cancelSubOrders();
        await logger.info('ORDER','END', this, '-');
    }

    async complete(isMarketOrderNow = false) {
        if(!this.strategyId) throw new StrategyNotExistError('Complete StrategyId Not Exist');
        this.active = ORDER_ALIVE.COMPLETE_AFTER_TRADE;
        await this.save();
        if(isMarketOrderNow === true) {
            await this.sellMarketNow();
        }
    }

    async stopAfterTrade(){
        if(!this.strategyId) throw new StrategyNotExistError('StopAfterTrade StrategyId Not Exist');
        const openExecuteQty = (this.direction === 'B2S') ? this.buyOpenExecuteQty :  this.sellOpenExecuteQty;
        const closeExecuteQty = (this.direction === 'B2S') ? this.buyCloseExecuteQty : this.sellCloseExecuteQty;
        const differenceQty = openExecuteQty - closeExecuteQty;

        if(differenceQty > 0) {
            this.active = ORDER_ALIVE.COMPLETE_AFTER_TRADE;
            await this.save();
        }else{
            throw new NotOpenFilledActionError('StopAfterTrade openFilledQty Less than zero');
        }
        return await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
    }

    async getBundleOrdersFromSubOrders(bundle) {
        let openOrder, takeProfitOrder, stopLossOrder, trailingOrder, sellMarketNowOrder;
        const subOrders = await model.Order.findAll({
            where: {
                orderPlanId: this.id,
                bundle: bundle
            },
            order: [['bundle', 'ASC'], ['indicatorType', 'ASC']]
        });

        for(const subOrder of subOrders) {
            if(subOrder.indicatorType === 'OPEN') {
                openOrder = subOrder;
            }
            else if(subOrder.indicatorType === 'TAKE') {
                takeProfitOrder = subOrder;
            }
            else if(subOrder.indicatorType === 'LOSS') {
                stopLossOrder = subOrder;
            }
            else if(subOrder.indicatorType === 'TRAIL') {
                trailingOrder = subOrder;
            }
            else if(subOrder.indicatorType === 'SELLMARKETNOW') {
                sellMarketNowOrder = subOrder
            }
        }
        return [openOrder, takeProfitOrder, stopLossOrder, trailingOrder, sellMarketNowOrder, subOrders];
    }

    async processCompleteOpenOrder(order) {
        const bundleOrders = await this.getBundleOrdersFromSubOrders(order.bundle);
        const [openOrder, takeProfitOrder, stopLossOrder, trailingOrder, sellMarketNowOrder, subOrders] = bundleOrders;
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);

        if(takeProfitOrder) {
            takeProfitOrder.active = ORDER_ALIVE.ACTIVE;
            takeProfitOrder.execQty = (takeProfitOrder.origQty >= order.filledQty) ?
                floorTicker(marketData['stepSize'], 8, order.filledQty) : takeProfitOrder.origQty;
            if(takeProfitOrder.indicators[0].hasOwnProperty('takeProfitPercent')) {
                const openPrice = order.filledAmount / order.filledQty;
                const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, this.symbol);
                const slippageInfo = await model.Slippage.findOne({where:{minimumPrice:{[Op.lte]: currentPrice}, maximumPrice:{[Op.gt]: currentPrice}}});
                const indicator = calc.trendLinePrice(openPrice, takeProfitOrder.indicators[0]['takeProfitPercent'], slippageInfo.slippage, takeProfitOrder.tradeType, takeProfitOrder.indicatorType, takeProfitOrder.side, tickSize);
                takeProfitOrder.indicators = [indicator];
            }
            saveList.push(takeProfitOrder);
            watchList.push(takeProfitOrder);
        }
        if(!takeProfitOrder && trailingOrder) {
            trailingOrder.active = ORDER_ALIVE.ACTIVE;
            trailingOrder.execQty = floorTicker(marketData['stepSize'], 8, order.filledQty);
            if(trailingOrder.indicators[0].hasOwnProperty('takeProfitPercent')) {
                const openPrice = order.filledAmount / order.filledQty;
                const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, this.symbol);
                const slippageInfo = await model.Slippage.findOne({where:{minimumPrice:{[Op.lte]: currentPrice}, maximumPrice:{[Op.gt]: currentPrice}}});
                const indicator = calc.trendLinePrice(openPrice, trailingOrder.indicators[0]['takeProfitPercent'], slippageInfo.slippage, trailingOrder.tradeType, trailingOrder.indicatorType, trailingOrder.side, tickSize);
                trailingOrder.indicators = [indicator];
            }
            saveList.push(trailingOrder);
            watchList.push(trailingOrder);
        }
        if(stopLossOrder) {
            const openPrice = order.filledAmount / order.filledQty;
            const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, this.symbol);
            const slippageInfo = await model.Slippage.findOne({where:{minimumPrice:{[Op.lte]: currentPrice}, maximumPrice:{[Op.gt]: currentPrice}}});
            stopLossOrder.active = ORDER_ALIVE.ACTIVE;
            stopLossOrder.execQty = floorTicker(marketData['stepSize'], 8, order.filledQty);
            if(stopLossOrder.indicators[0].hasOwnProperty('stopLossPercent')) {
                const indicator = calc.trendLinePrice(openPrice, stopLossOrder.indicators[0]['stopLossPercent'], slippageInfo.slippage , stopLossOrder.tradeType, stopLossOrder.indicatorType, stopLossOrder.side, tickSize);
                stopLossOrder.indicators = [indicator];
            }
            saveList.push(stopLossOrder);
            watchList.push(stopLossOrder);
        }
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
    }

    async processCompleteTakeProfitOrder(order) {
        const user = order['user'];
        const bundleOrders = await this.getBundleOrdersFromSubOrders(order.bundle);
        const [openOrder, takeProfitOrder, stopLossOrder, trailingOrder, sellMarketNowOrder, subOrders] = bundleOrders;
        let needStartStrategyNew = false;
        let needInputTradingContestRecord = false;
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);

        if(order.indicatorType === 'TAKE') {
            if(trailingOrder) {
                trailingOrder.active = ORDER_ALIVE.ACTIVE;
                trailingOrder.execQty = floorTicker(marketData['stepSize'], 8, openOrder.filledQty - order.filledQty);
                saveList.push(trailingOrder);
                watchList.push(trailingOrder);
                if(stopLossOrder) {
                    stopLossOrder.execQty = trailingOrder.execQty;
                    saveList.push(stopLossOrder);
                    watchList.push(stopLossOrder);
                }
            }
            else {
                needInputTradingContestRecord = true;
                if(stopLossOrder) {
                    stopLossOrder.active = ORDER_ALIVE.CANCELED;
                    stopLossOrder.status = 'COMPLETE_CANCEL';
                    saveList.push(stopLossOrder);
                    watchList.push(stopLossOrder);
                }
                needStartStrategyNew = this.getNextStrategyStatusWithChangeActive();
            }
        }
        else if(order.indicatorType === 'TRAIL') {
            if(stopLossOrder) {
                stopLossOrder.active = ORDER_ALIVE.CANCELED;
                stopLossOrder.status = 'COMPLETE_CANCEL';
                saveList.push(stopLossOrder);
                watchList.push(stopLossOrder);
            }
            needStartStrategyNew = this.getNextStrategyStatusWithChangeActive();
            needInputTradingContestRecord = true;
        }
        await this.save();
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        if(needInputTradingContestRecord) {
            await this.inputTradingContestRecord(user, openOrder, takeProfitOrder, trailingOrder, stopLossOrder, sellMarketNowOrder);
        }
        if(needStartStrategyNew) {
            const subOrderInfos = await this.makeSubOrderInfos({strategyId:this.strategyId}, order.bundle+1);
            await this.start(subOrderInfos);
        }
        else{
            if(this.active === ORDER_ALIVE.COMPLETE){
                await logger.info('ORDER','END',this,'-');
            }
        }
    }

    async processCompleteStopLossOrder(order) {
        const user = order['user'];
        const bundleOrders = await this.getBundleOrdersFromSubOrders(order.bundle);
        const [openOrder, takeProfitOrder, stopLossOrder, trailingOrder, sellMarketNowOrder, subOrders] = bundleOrders;
        let needStartStrategyNew = false;
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        for(const subOrder of subOrders) {
            if(subOrder.id === stopLossOrder.id || subOrder.id === openOrder.id) {
                continue;
            }
            subOrder.active = ORDER_ALIVE.CANCELED;
            if(subOrder.status === 'PENDING') {
                subOrder.status = "COMPLETE_CANCEL";
                cancelOrderList.push(subOrder.id);
            }
            else {
                subOrder.status = "COMPLETE_CANCEL";
                watchList.push(subOrder);
            }
        }
        needStartStrategyNew = this.getNextStrategyStatusWithChangeActive();
        await this.save();
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
        await this.inputTradingContestRecord(user, openOrder, takeProfitOrder, trailingOrder, stopLossOrder, sellMarketNowOrder);
        if(needStartStrategyNew) {
            const subOrderInfos = await this.makeSubOrderInfos({strategyId:this.strategyId}, order.bundle+1);
            await this.start(subOrderInfos);
        }
        else{
            if(this.active === ORDER_ALIVE.COMPLETE){
                await logger.info('ORDER','END',this,'-');
            }
        }
    }

    getNextStrategyStatusWithChangeActive() {
        let needStartStrategyNew = false;
        if(this.active === ORDER_ALIVE.COMPLETE_AFTER_TRADE) {
            this.active = ORDER_ALIVE.COMPLETE;
        }
        else if(this.active === ORDER_ALIVE.STOP_AFTER_TRADE) {
            this.active = ORDER_ALIVE.STOP_BY_USER;
        }
        else {
            needStartStrategyNew = true;
        }
        return needStartStrategyNew;
    }

    async processCompleteSellNowMarketOrder(order) {
        const needStartStrategyNew = this.getNextStrategyStatusWithChangeActive();
        const bundleOrders = await this.getBundleOrdersFromSubOrders(order.bundle);
        const [openOrder, takeProfitOrder, stopLossOrder, trailingOrder, sellMarketNowOrder, subOrders] = bundleOrders;
        await this.inputTradingContestRecord(order['user'], openOrder, takeProfitOrder, trailingOrder, stopLossOrder, sellMarketNowOrder);
        if(needStartStrategyNew) {
            const subOrderInfos = await this.makeSubOrderInfos({strategyId:this.strategyId}, order.bundle+1);
            await this.start(subOrderInfos);
        }
        else {
            this.active = ORDER_ALIVE.COMPLETE;
            await this.save();
            await logger.info('ORDER', 'END', this, '-');
        }
    }

    async inputTradingContestRecord(user, openOrder, takeProfitOrder, trailingOrder, stopLossOrder, sellMarketNowOrder) {
        try {
            if(this.direction === 'S2B') {
                return;
            }
            const tradingContests = await model['TradingContest'].getOngoingTradingContests();
            const openAmount = openOrder.filledAmount;
            const closeAmount = (sellMarketNowOrder && sellMarketNowOrder.filledAmount > 0) ? sellMarketNowOrder.filledAmount :
                (takeProfitOrder && takeProfitOrder.filledAmount > 0) ? ((trailingOrder && trailingOrder.filledAmount > 0) ?
                    takeProfitOrder.filledAmount + trailingOrder.filledAmount : takeProfitOrder.filledAmount) :
                    (stopLossOrder && stopLossOrder.filledAmount > 0)  ? stopLossOrder.filledAmount : 0;
            if(closeAmount === 0) {
                return;
            }
            for(const tradingContest of tradingContests) {
                if(tradingContest.contestType === 'BestRateOfReturn') {
                    const score = parseFloat((closeAmount - openAmount) / openAmount * 100).toFixed(2) * ((this.direction === 'B2S') ? 1 : -1);
                    await tradingContest.recordTradingByBestRateOfReturn(user, this.exchange, score);
                }
                else if(tradingContest.contestType === 'TotalRateOfReturn') {
                    const score = (closeAmount - openAmount) * ((this.direction === 'B2S') ? 1 : -1);
                    await tradingContest.recordTradingByTotalRateOfReturn(user, this.exchange, this.symbol, score);
                }
            }
        }
        catch (e) {
            await logger.error(e);
        }
    }
}

module.exports = StrategyOrderPlan;