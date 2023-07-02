'use strict';

const model = require('../internal');
const redisCtrl = require('../../modules/redisCtrl');
const { BasicOrderOpenFilledActionError, NotAllowedCompletedOrderError, SubOrderNotExistError } = require('../../modules/error');
const config = require('../../config');
const { ORDER_ALIVE } = require('../../enum');
const logger = require('../../modules/logger');
const { floorTicker } = require('../../modules/utils');


class BasicOrderPlan extends model.OrderPlan{
    constructor(...args) {
        super(...args);
    }

    async makeSubOrderInfos(orderPlanInfo) {
        const {stepSize, tickSize} = await redisCtrl.getMarketData(this.exchange, this.symbol);
        super.checkEnterPrice(orderPlanInfo, tickSize);
        let openInfo;
        const qty = floorTicker(stepSize, 8, orderPlanInfo.openInfo[0].qty);
        const indicator = {
            enterPrice: orderPlanInfo.openInfo[0].enterPrice,
            qty,
        };
        openInfo = [{
            side: orderPlanInfo.openInfo[0].side,
            tradeType: orderPlanInfo.openInfo[0].tradeType,
            indicatorType: 'OPEN',
            orderOptions: orderPlanInfo.orderOptions ? orderPlanInfo.orderOptions : {},
            qty,
            indicators: [indicator]
        }];

        return [openInfo, [], []];
    }

    async start(orderInfos, seqTransaction=null) {
        const openInfos = orderInfos[0];
        const subOrder = await model.Order.makeNew(this.userId, this.id, this.exchange, this.symbol, this.planType, openInfos[0], openInfos[0].qty);
        this['subOrders'] = [subOrder];
        const saveOption = {};
        if(seqTransaction) {
            saveOption['transaction'] = seqTransaction;
        }
        await subOrder.save(saveOption);
        if(seqTransaction) {
            await seqTransaction.commit();
        }
        await logger.info('ORDER', 'NEW', subOrder);
        await subOrder.sendOrderQueue();
    }

    async modify(orderPlanInfo) {
        if([ORDER_ALIVE.COMPLETE, ORDER_ALIVE.CANCELED].includes(this.active)) throw new NotAllowedCompletedOrderError(`Basic Order Modify NotAllowed Action OrderPlanActive=${this.active}`);
        await logger.info('ORDER','MODIFY', this,'-');
        const [saveList, cancelOrderList, watchList] = [[],[],[]];
        const [openInfo, [], []] = await this.makeSubOrderInfos(orderPlanInfo);
        const subOrders = await model.Order.findAll({where:{orderPlanId:this.id, active:{[model.Sequelize.Op.gte]:ORDER_ALIVE.WAITING}}});
        if(subOrders.length == 0) {
            throw new SubOrderNotExistError(`BasicOrder is not exist`);
        }
        const basicOrder = subOrders[0];
        if(basicOrder.filledQty > 0) {
            throw new BasicOrderOpenFilledActionError('BasicOrder openFilledQty be greater than zero');
        }
        basicOrder.modify(openInfo[0]);
        basicOrder.status = 'MODIFY_CANCEL';
        basicOrder.active = ORDER_ALIVE.CANCELED;
        cancelOrderList.push(basicOrder.id);
        saveList.push(basicOrder);

        await this.saveAndSendSubOrder(saveList, [], cancelOrderList, watchList);
        await redisCtrl.pushQueue(`socket:parser`,
            `apiOrder||${this.exchange}||${this.userId}||${(this.isVirtual == true) ? 'virtual' : 'actual'}||${JSON.stringify({orderPlanId: this.id})}`);
        super.sendTelegramMessage('MODIFY').catch(e => {});
    }

    async saveAndSendSubOrder(saveList=[], closeOrderList=[], cancelOrderList=[], watcherList=[]) {
        if(watcherList.length > 0) {
            const sendOrderBotList = watcherList;
            watcherList = [];
        }
        await super.saveAndSendSubOrder(saveList, closeOrderList, cancelOrderList, watcherList);
        for(const subOrder of watcherList) {
            await subOrder.sendOrderQueue();
        }
        return;
    }

    async convertMyOrderForm() {
        const openInfos = [];
        const commissionMap = {};

        this['subOrders'].map(async(subOrder) => {
            const orderInfo = await subOrder.convertInfoForm(this);
            openInfos.push(orderInfo);
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
            takeProfitInfo: [],
            stopLossInfo: [],
            commission: commissionMap,
            systemMessage: this.systemMessage
        };
        return result;
    }

    async processCompleteOpenOrder(order) {
        if(order.status === 'COMPLETE') {
            this.active = ORDER_ALIVE.COMPLETE;
            await this.save();
            await logger.info('ORDER', 'END', this, '-');
        }
    }
}

module.exports = BasicOrderPlan;