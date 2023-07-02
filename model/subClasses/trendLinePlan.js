'use strict';

const model = require('../internal');
const redisCtrl = require('../../modules/redisCtrl');
const calc = require('../../modules/calc');
const { roundTicker, floorTicker } = require('../../modules/utils');
const { ORDER_ALIVE } = require('../../enum');
const config = require('../../config');
const logger = require('../../modules/logger');
const {Op} = require('sequelize');
const { NotAllowedCompletedOrderError, ParameterError } = require('../../modules/error')

class TrendLineOrderPlan extends model.OrderPlan {
    constructor(...args) {
        super(...args);
    }

    async makeSubOrderInfos(orderPlanInfo) {
        let [openInfo, takeProfitInfo, stopLossInfo] = [[],[],[]];
        openInfo.push(this.makeOpenIndicators(orderPlanInfo.openInfo[0]));

        const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, this.symbol);
        const {stepSize} = await redisCtrl.getMarketData(this.exchange, this.symbol);
        const slippageInfo = await model['Slippage'].findOne({where:{minimumPrice:{[Op.lte]: currentPrice}, maximumPrice:{[Op.gt]: currentPrice}}});

        for(const orderInfo of orderPlanInfo.takeProfitInfo) {
            takeProfitInfo = takeProfitInfo.concat(this.makeTakeProfitIndicators(orderInfo, stepSize));
        }

        for(const orderInfo of orderPlanInfo.stopLossInfo) {
            stopLossInfo.push(this.makeStopLossIndicators(orderInfo, 'Market', slippageInfo, tickSize, stepSize))
        }
        return [openInfo, takeProfitInfo, stopLossInfo];
    }

    makeOpenIndicators(orderInfo) {
        if(!orderInfo.qty) {
            throw new ParameterError(`openQty`);
        }
        return {
            side: orderInfo.side,
            tradeType: 'Market',
            indicatorType: "OPEN",
            qty: orderInfo.qty,
            orderOptions: orderInfo.orderOptions,
            indicators: [{
                startDate: new Date(parseInt(orderInfo.startDate)),
                endDate: new Date(parseInt(orderInfo.endDate)),
                period: orderInfo.period,
                tradingStartPrice: parseFloat(orderInfo.tradingStartPrice).toFixed(8),
                tradingEndPrice: parseFloat(orderInfo.tradingEndPrice).toFixed(8),
            }]
        }
    }

    makeTakeProfitIndicators(orderInfo, stepSize) {
        const takeProfitInfo = [];
        let trailingInfo;
        if(orderInfo['trailingVolume'] && parseFloat(orderInfo['trailingVolume']) > 0) {
            trailingInfo = {
                side: orderInfo.side,
                tradeType: 'Trail',
                indicatorType:'TRAIL',
                qty: floorTicker(stepSize, 8, Math.round(orderInfo.qty * parseFloat(orderInfo['trailingVolume']) / 100)),
                trailingValue: orderInfo.trailingValue,
                orderOptions: orderInfo.orderOptions,
                indicators: [{
                    takeProfitPercent: orderInfo.takeProfitPercent
                }]
            };
            if(orderInfo.bundle) {
                trailingInfo['bundle'] = orderInfo.bundle;
            }
            takeProfitInfo.push(trailingInfo);
        }
        if(!orderInfo['trailingVolume'] || orderInfo['trailingVolume'] < 100) {
            const info = {
                side: orderInfo.side,
                tradeType: 'TakeProfitLimit',
                indicatorType:'TAKE',
                qty: floorTicker(stepSize, 8, (trailingInfo) ?  orderInfo.qty - trailingInfo.qty : orderInfo.qty),
                orderOptions: orderInfo.orderOptions,
                indicators: [{
                    takeProfitPercent: orderInfo.takeProfitPercent,
                }]
            };
            if(orderInfo.bundle) {
                info.bundle = orderInfo.bundle;
            }
            takeProfitInfo.push(info)
        }
        for(const orderInfo of takeProfitInfo) {
            if(!orderInfo.qty || orderInfo.qty == 0) {
                throw new ParameterError(`takeProfitQty`);
            }
        }
        return takeProfitInfo;
    }

    makeStopLossIndicators(orderInfo, orderLimit, slippageInfo, tickSize, stepSize) {
        if(!orderInfo.qty) {
            throw new ParameterError(`stopLossOrderQty`);
        }
        if(orderInfo.hasOwnProperty('stopLossPercent')) {
            return {
                side: orderInfo.side,
                tradeType: orderLimit,
                indicatorType: 'LOSS',
                qty: floorTicker(stepSize, 8, orderInfo.qty),
                orderOptions: orderInfo.orderOptions,
                indicators: [{
                    stopLossPercent: orderInfo.stopLossPercent
                }]
            }
        }

        return super.makeStopLossIndicators(orderInfo, orderLimit, slippageInfo, tickSize);
    }

    async modify(orderPlanInfo) {
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`TrendLine Order Modify NotAllowed Action OrderPlanActive=${this.active}`);
        orderPlanInfo['symbol'] = this.symbol;
        orderPlanInfo['direction'] = this.direction;
        await logger.info('ORDER','MODIFY', this, '-');
        const subOrderMap = await super.getSubOrderMap();
        let [openInfo, takeProfitInfo, stopLossInfo] = [[],[],[]];
        openInfo.push(this.makeOpenIndicators(orderPlanInfo.openInfo[0]));
        const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, this.symbol);
        this.checkEnterPrice(orderPlanInfo, tickSize);
        const slippageInfo = await model.Slippage.findOne({where:{minimumPrice:{[Op.lte]: currentPrice}, maximumPrice:{[Op.gt]: currentPrice}}});
        for(const orderInfo of orderPlanInfo.takeProfitInfo) {
            if(orderInfo.hasOwnProperty('takeProfitPercent')) {
                takeProfitInfo = takeProfitInfo.concat(this.makeTakeProfitIndicators(orderInfo));
            }
            else {
                takeProfitInfo = takeProfitInfo.concat(this.makePriceIndicators('TAKE', orderInfo, 'TakeProfitLimit', slippageInfo, tickSize));
            }
        }
        for(const orderInfo of orderPlanInfo.stopLossInfo) {
            stopLossInfo.push(this.makeStopLossIndicators(orderInfo, 'Market', slippageInfo, tickSize));
        }
        await this.modifySubOrders(subOrderMap, openInfo, takeProfitInfo, stopLossInfo);
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('MODIFY').catch(e => {return;});
    }

    async processCompleteOpenOrder(order) {
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];
        const openPrice = order.filledAmount / order.filledQty;
        const subOrders = await model.Order.findAll({
            where:{
                orderPlanId:this.id,
                active: {[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE,ORDER_ALIVE.CANCELED]},
                indicatorType: {[model.Sequelize.Op.ne]:'OPEN'}
            },
            order: [['bundle', 'ASC'], ['indicatorType', 'ASC']]
        });
        const currentPrice = await redisCtrl.getCurrentPrice(this.exchange, order.symbol);
        const marketData = await redisCtrl.getMarketData(this.exchange, order.symbol);
        const slippageInfo = await model.Slippage.findOne({
            where:{
                minimumPrice:{[Op.lte]: currentPrice},
                maximumPrice:{[Op.gt]: currentPrice}}
        });

        let qty = 0;
        for(const subOrder of subOrders) {
            let orderQty = 0;
            if(subOrder.indicators[0]['takeProfitPercent']) {
                const indicator = calc.trendLinePrice(openPrice, subOrder.indicators[0]['takeProfitPercent'], slippageInfo.slippage, subOrder.tradeType, subOrder.indicatorType, subOrder.side, marketData['tickSize']);
                subOrder.indicators = [indicator];
                if(this.isCloseTypeAmount) {
                    const subOrderAmount = this.openAmount * subOrder.origQty / 100;
                    orderQty = floorTicker(marketData['stepSize'], 8, subOrderAmount / parseFloat(subOrder.indicators[0]['enterPrice']));
                    qty += orderQty;
                }
                else {
                    const floorOpenExecuteQty = floorTicker(marketData['stepSize'], 8, this.openExecuteQty);
                    orderQty = ( floorOpenExecuteQty >= subOrder.origQty + qty) ? subOrder.origQty : floorOpenExecuteQty - qty;
                    qty += orderQty;
                }
                watchList.push(subOrder);
            }
            if(subOrder.indicators[0]['stopLossPercent']) {
                const indicator = calc.trendLinePrice(openPrice, subOrder.indicators[0]['stopLossPercent'], slippageInfo.slippage, subOrder.tradeType, subOrder.indicatorType, subOrder.side, marketData['tickSize']);
                subOrder.indicators = [indicator];
                orderQty = floorTicker(marketData['stepSize'], 8, this.openExecuteQty);
                if(this.direction === 'S2B') {
                    if(this.isCloseTypeAmount == true) {
                        const subOrderAmount = this.openAmount * subOrder.origQty / 100;
                        orderQty =  floorTicker(marketData['stepSize'], 8, subOrderAmount / parseFloat(subOrder.indicators[0].enterPrice));
                    }
                    else {
                        const quoteAsset = this.symbol.split('-')[1];
                        const myBalance = await redisCtrl.getUserBalance(this.userId, this.exchange, quoteAsset, this.isVirtual);
                        if(parseFloat(subOrder.indicators[0].enterPrice) * orderQty > parseFloat(myBalance.free)) {
                            orderQty = floorTicker(marketData['stepSize'], 8, parseFloat(myBalance.free) / parseFloat(subOrder.indicators[0].enterPrice));
                        }
                    }
                }
                watchList.push(subOrder);
            }
            subOrder.execQty = orderQty;
            subOrder.active = ORDER_ALIVE.ACTIVE;
            saveList.push(subOrder);
        }
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
    }
}

module.exports = TrendLineOrderPlan;