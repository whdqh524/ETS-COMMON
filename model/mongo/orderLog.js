const mongoose = require("mongoose");
const mSchema = mongoose.Schema;
const redisCtrl = require('../../modules/redisCtrl');


const orderLogSchema = new mSchema({
            userId: {type: String, required: true},
            orderPlanId: {type: String, required: false},
            orderId: {type: String, required: false},
            exchange: {type: String},
            symbol: {type: String, required: false},
            quote: {type: String, required: false},
            planType: {type: String, required: true},
            indicatorType: {type: String, required: true},
            bundle: {type: String, required: true},
            action: {type: String, required: true},
            direction: {type: String, required: true},
            isVirtual:{type: String, required: true, get: function (isVirtual) {return isVirtual !== '-' ? isVirtual === 'true' : isVirtual}},
            content: {type: mSchema.Types.Mixed},
            createdAt: {type: Date, required: true},
        });

orderLogSchema.index({quote: 1, symbol: -1});
orderLogSchema.index({exchange: -1, isVirtual: 1, planType: -1, direction: -1});
orderLogSchema.index({userId: 1, orderPlanId: 1, indicatorType: -1, action: 1});
orderLogSchema.index({createdAt: -1});

orderLogSchema.statics.makeNew = async function(action, orderInfo, content){
    const saveOrderForm = parserSaveOrderLogForm(orderInfo, action, content);
    await this.create(saveOrderForm);
};

orderLogSchema.statics.makeNewMany = async function (action, orderInfo, content) {
    const saveOrderLogFormList = [];
    for(const order of orderInfo){
        saveOrderLogFormList.push(parserSaveOrderLogForm(order, action, content));
    }
    await this.insertMany(saveOrderLogFormList);
};

orderLogSchema.statics.getSubOrderLog = async function (requestQuery) {

    const pageSize = requestQuery.pageSize ? parseInt(requestQuery.pageSize) : 20;
    const pageNumber = requestQuery.pageNumber ? parseInt(requestQuery.pageNumber) : 1;
    const startDate = requestQuery.startDate ? parseInt(requestQuery.startDate) : new Date().setMonth(new Date().getMonth() - 3);
    const endDate = requestQuery.endDate ? parseInt(requestQuery.endDate) : new Date().getTime();

    const subOrderWhereQuery = {
        orderPlanId: requestQuery.orderPlanId,
        action: {"$in": JSON.parse(requestQuery.action)},
        indicatorType: {"$in": JSON.parse(requestQuery.indicatorType)},
        createdAt: {"$gte":startDate, "$lte": endDate},
    };
    const orderLogs = await this.find(subOrderWhereQuery)
        .limit(pageSize)
        .skip((pageNumber -1) * pageSize)
        .sort({createdAt: -1});

    const orderLogCount = await this.countDocuments(subOrderWhereQuery);
    return [orderLogCount, orderLogs];
};

orderLogSchema.statics.getCsvDownloadSubOrderLog = async function (requestQuery) {

    const startDate = requestQuery.startDate ? parseInt(requestQuery.startDate) : new Date().setMonth(new Date().getMonth() - 3);
    const endDate = requestQuery.endDate ? parseInt(requestQuery.endDate) : new Date().getTime();

    const subOrderWhereQuery = {
        orderPlanId: requestQuery.orderPlanId,
        action: {"$in": JSON.parse(requestQuery.action)},
        indicatorType: {"$in": JSON.parse(requestQuery.indicatorType)},
        createdAt: {"$gte":startDate, "$lte": endDate},
    };
    return await this.find(subOrderWhereQuery).sort({createdAt: -1});
};




orderLogSchema.statics.getSubOrderStrategyLog = async function (orderPlanId, requestQuery) {
    const subOrderWhereQuery = {
        orderPlanId: orderPlanId,
        planType: 'strategy',
        action: {"$in": JSON.parse(requestQuery.action)},
        indicatorType: {"$in": JSON.parse(requestQuery.indicatorType)},
        createdAt: {"$gte":requestQuery['startDate'], "$lte": requestQuery['endDate']},

    };
    return await this.find(subOrderWhereQuery).sort({createdAt: -1});
};

function parserSaveOrderLogForm(order, action, content) {

    const saveOrderLogForm = {
            userId: order.userId,
            orderPlanId: order.orderPlanId ? order.orderPlanId : order.id,
            orderId: order.orderPlanId ? order.id : '-',
            exchange: order.exchange,
            planType: order.planType,
            symbol: order.symbol,
            quote: order.symbol.split('-')[1],
            indicatorType: order.indicatorType ? order.indicatorType : '-',
            bundle: order.bundle ? order.bundle : '-',
            action: action,
            direction: order.direction ? order.direction : '-',
            isVirtual: 'isVirtual' in order ? String(order.isVirtual): '-',
            createdAt: new Date(),
        };
    saveOrderLogForm['content'] = content ? content : parserOrderContentsForm(order);
    return saveOrderLogForm
}


function parserOrderContentsForm(subOrder){
    let orderContent = {};
    if(subOrder.indicatorType === 'SELLMARKETNOW'){
        orderContent = {
            message : 'close now',
            origin: subOrder.origQty,
        };
    }

    if(subOrder.filledQty > 0) {
        orderContent = {
            filledPrice: (subOrder.filledAmount * 100000000) / (subOrder.filledQty * 100000000),
            filledQty: subOrder.filledQty,
            commission: subOrder.commission,
        };
    }
    else if(subOrder.indicators[0].enterPrice) {
        if(subOrder.planType === 'basic'){
            orderContent = {
                origQty: subOrder.origQty,
                tradeType: subOrder.tradeType
            };
            if (subOrder.tradeType !== 'Market') orderContent['enterPrice'] = subOrder.indicators[0].enterPrice;
        }
        else{
            orderContent = {
                enterPrice: subOrder.indicators[0].enterPrice,
                origQty: subOrder.origQty,
            };
        }
        if(subOrder.planType === 'basic') orderContent['tradeType'] = subOrder.tradeType;
    }
    else {
        if(subOrder.planType === 'strategy'){
            if(subOrder.strategyQty){
                orderContent = {strategyQty: subOrder.strategyQty};
            }
            else{
                orderContent = {originQty: subOrder.origQty};
            }
        }
        else{
            if(subOrder.indicatorType === 'OPEN'){
                orderContent = {
                    tradingStartTime: subOrder.indicators[0].startDate,
                    tradingEndTime: subOrder.indicators[0].endDate,
                    tradingStartPrice: subOrder.indicators[0].tradingStartPrice,
                    tradingEndPrice: subOrder.indicators[0].tradingEndPrice,
                    origQty: subOrder.origQty,
                };
            }
            else if(subOrder.indicatorType === 'TAKE'){
                orderContent = {
                    takeProfitPercent: subOrder.indicators[0].takeProfitPercent,
                    origQty: subOrder.origQty
                };
            }
            else if(subOrder.indicatorType === 'LOSS'){
                orderContent = {
                    stopLossPercent: subOrder.indicators[0].stopLossPercent,
                    origQty: subOrder.origQty
                };
            }
        }
    }
    return orderContent;
}

orderLogSchema.statics.setOrderPlanTypeStatus = async function (startDate, nowDate, exchange) {

    const orderLogs = await this.aggregate([
        {$match: {
            $and: [
                {createdAt: {$gt: startDate, $lte: nowDate}},
                {action: {$in: ['NEW', 'END']}},
                {orderId: '-'},
                {isVirtual: 'false'},
                {exchange: exchange}
                ]}},
        {$group: {
            _id: {planType: "$planType", action: '$action', direction: '$direction'},
            count:{$sum:1},
        }},
    ]);
    const orderPlanStatus = {
        NEW: {},
        END: {}
    };
    for(const orderLog of orderLogs){
        if(!orderPlanStatus[orderLog._id.action].hasOwnProperty(orderLog._id.planType)) orderPlanStatus[orderLog._id.action][orderLog._id.planType] = {};
        orderPlanStatus[orderLog._id.action][orderLog._id.planType][orderLog._id.direction] = orderLog.count;
    }
    await redisCtrl.setAdminDashBoardData('orderPlanStatus', orderPlanStatus, exchange);
};

orderLogSchema.statics.setOrderMarketStatus = async function(startDate, nowDate, exchange) {
    const marketLogs = await this.aggregate([
        {
            $match: {
                $and: [
                    {createdAt: {$gt: startDate, $lte: nowDate}},
                    {action: {$in: ['NEW', 'END']}},
                    {orderId: '-'},
                    {isVirtual: 'false'},
                    {exchange: exchange}
                ]
            }
        },
        {
            $group: {
                _id: {quote: "$quote", symbol: "$symbol", action: "$action"},
                count: {$sum:1}
            }
        },
        {
            $group: {
                _id: {quote:"$_id.quote", action:'$_id.action'},
                symbols: {
                    $push: { symbol: "$_id.symbol", count: "$count"},
                },
            },
        },
    ]);

    const symbolData = {
        NEW:{},
        END:{}
    };
    for(const marketLog of marketLogs){
        symbolData[marketLog._id.action][marketLog._id.quote] = marketLog.symbols;
    }

    await redisCtrl.setAdminDashBoardData('marketStatus', symbolData, exchange);
};


module.exports = (connectionPool) => {
    return connectionPool.model('OrderLog', orderLogSchema);
};




