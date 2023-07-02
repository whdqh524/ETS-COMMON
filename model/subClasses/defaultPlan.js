'use strict';

const model = require('../internal');
const redisCtrl = require('../../modules/redisCtrl');
const config = require('../../config');
const logger = require('../../modules/logger');
const { MAX_COMMISSION, ORDER_ALIVE } = require('../../enum');
const { roundTicker, floorTicker } = require('../../modules/utils');
const { NotAllowedCompletedOrderError } = require('../../modules/error');

class DefaultOrderPlan extends model.OrderPlan {
    constructor(...args) {
        super(...args);
    }

    async makeSubOrderInfos(orderPlanInfo) {
        const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, orderPlanInfo.symbol);
        const {stepSize} = await redisCtrl.getMarketData(this.exchange, orderPlanInfo.symbol);
        super.checkEnterPrice(orderPlanInfo, tickSize);

        let [openInfo, takeProfitInfo, stopLossInfo] = [[],[],[]];
        const slippageInfo = await model.Slippage.findOne({
            where:{
                minimumPrice:{[model.Sequelize.Op.lte]: currentPrice},
                maximumPrice:{[model.Sequelize.Op.gt]: currentPrice}}
        });
        for(const orderInfo of orderPlanInfo.openInfo) {
            let orderLimit;
            if(orderInfo.side == "BUY") {
                orderLimit = (parseFloat(orderInfo.enterPrice) >= currentPrice) ? 'Market' : 'Limit';
            }else if(orderInfo.side == "SELL") {
                orderLimit = (parseFloat(orderInfo.enterPrice) <= currentPrice) ? 'Market' : 'Limit';
            }
            openInfo = openInfo.concat(this.makePriceIndicators('OPEN', orderInfo, orderLimit, slippageInfo, tickSize, stepSize));
        }

        for(const orderInfo of orderPlanInfo.takeProfitInfo) {
            takeProfitInfo = takeProfitInfo.concat(this.makePriceIndicators('TAKE', orderInfo, 'TakeProfitLimit', slippageInfo, tickSize, stepSize));
        }

        for(const orderInfo of orderPlanInfo.stopLossInfo) {
            stopLossInfo.push(this.makeStopLossIndicators(orderInfo, 'Market', slippageInfo, tickSize, stepSize));
        }
        return [openInfo, takeProfitInfo, stopLossInfo];
    }

    async modify(orderPlanInfo) {
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`default Order Modify NotAllowed Action OrderPlanActive=${this.active}`);
        await logger.info('ORDER','MODIFY', this, '-');
        orderPlanInfo['symbol'] = this.symbol;
        orderPlanInfo['direction'] = this.direction;
        const subOrderMap = await super.getSubOrderMap();
        const [currentPrice, tickSize] = await redisCtrl.getCurrentPriceAndTick(this.exchange, this.symbol);
        this.checkEnterPrice(orderPlanInfo, tickSize);
        const [openInfo, takeProfitInfo, stopLossInfo] = await this.makeSubOrderInfos(orderPlanInfo, currentPrice, tickSize);
        await this.modifySubOrders(subOrderMap, openInfo, takeProfitInfo, stopLossInfo);
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('MODIFY').catch(e => {return;});
    }

    async processCompleteOpenOrder(order) {
        const marketData = await redisCtrl.getMarketData(this.exchange, this.symbol);
        if(order.executedQty < parseFloat(marketData.minNotional)) {
            return;
        }
        const [saveList, closeOrderList, cancelOrderList, watchList] = [[],[],[],[]];

        const subOrders = await model.Order.findAll({
            where:{
                orderPlanId:this.id,
                active: {[model.Sequelize.Op.notIn]:[ORDER_ALIVE.COMPLETE,ORDER_ALIVE.CANCELED]},
                indicatorType: {[model.Sequelize.Op.ne]:'OPEN'}
            },
            order: [['bundle', 'ASC'], ['indicatorType', 'ASC']]
        });

        let qty = 0;
        for(const subOrder of subOrders) {
            if(qty != 0 && qty >= this.openExecuteQty) {
                break;
            }
            if(subOrder.indicatorType === 'LOSS') {
                let orderQty = floorTicker(marketData['stepSize'], 8, this.openExecuteQty);
                if(this.direction === 'S2B') {
                    if(this.isCloseTypeAmount == true) {
                        orderQty = floorTicker(marketData['stepSize'], 8,
                            this.openAmount / parseFloat(subOrder.indicators[0].enterPrice));
                    }
                    else {
                        const quoteAsset = this.symbol.split('-')[1];
                        const myBalance = await redisCtrl.getUserBalance(this.userId, this.exchange, quoteAsset, this.isVirtual);
                        if(parseFloat(subOrder.indicators[0].enterPrice) * orderQty > parseFloat(myBalance.free)) {
                            orderQty = floorTicker(marketData['stepSize'], 8, parseFloat(myBalance.free) / parseFloat(subOrder.indicators[0].enterPrice));
                        }
                    }
                }
                if(subOrder.execQty == orderQty) {
                    continue;
                }
                subOrder.active = ORDER_ALIVE.ACTIVE;
                subOrder.execQty = orderQty;
                saveList.push(subOrder);
                watchList.push(subOrder);
                continue;
            }
            let orderQty = 0;
            if(this.isCloseTypeAmount) {
                const subOrderAmount = this.openAmount * subOrder.origQty / 100;
                orderQty = floorTicker(marketData['stepSize'], 8, subOrderAmount / parseFloat(subOrder.indicators[0].enterPrice));
            }
            else {
                const floorOpenExecuteQty = floorTicker(marketData['stepSize'], 8, this.openExecuteQty);
                orderQty = (floorOpenExecuteQty >= subOrder.origQty + qty) ? subOrder.origQty : floorOpenExecuteQty - qty;
            }
            qty += orderQty;
            if(subOrder.active == ORDER_ALIVE.ACTIVE && subOrder.execQty == orderQty) {
                continue;
            }
            subOrder.execQty = floorTicker(marketData['stepSize'], 8, orderQty);
            subOrder.active = ORDER_ALIVE.ACTIVE;
            saveList.push(subOrder);
            watchList.push(subOrder);
        }
        await this.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watchList);
    }
}

module.exports = DefaultOrderPlan;