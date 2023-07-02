const mongoose = require('mongoose');
const mSchema = mongoose.Schema;
const redisCtrl = require('../../modules/redisCtrl');

const strategyIndicatorLogSchema = new mongoose.Schema({
    userId: {type: String},
    orderPlanId: {type: String},
    exchange: {type: String},
    isVirtual:{type: Boolean},
    side: {type: String},
    indicatorName:{type: String},
    createdAt: {type: Date},
});


strategyIndicatorLogSchema.index({exchange: 1, isVirtual: -1, side: -1, indicatorName: -1});


strategyIndicatorLogSchema.statics.makeNew = async function(orderInfo){

    let strategyIndicatorName = '';
    const saveList = [];
    for(const indicator of orderInfo.indicators){
        if(indicator.name){
            (orderInfo.indicators.length >= 2) ? strategyIndicatorName = `${indicator.name}+`: strategyIndicatorName = indicator.name;
            saveList.push({
                exchange: orderInfo.exchange,
                indicatorName: strategyIndicatorName,
                side: orderInfo.side,
                orderPlanId: orderInfo.orderPlanId,
                userId: orderInfo.userId,
                isVirtual: orderInfo.isVirtual,
                createdAt: new Date()
            });
        }

    }
    await this.insertMany(saveList);
};

strategyIndicatorLogSchema.statics.setStrategyIndicatorNewStatus = async function(startDate, nowDate, exchange){
    const result = {
        BUY: [],
        SELL: [],
    };
    const strategyIndicatorSideLogs = await this.aggregate([
        {$match: {
            $and:[
                {createdAt: {$gt: startDate, $lte: nowDate}},
                {isVirtual: false},
                {exchange: exchange},
            ]
        }},
        {
            $group: {
                _id: {
                    side:"$side",
                    indicatorName:"$indicatorName"
                },
                indicatorNameCount:{$sum:1}
            }
        },
        {
            $group: {
                _id: "$_id.side",
                indicators:{
                    $push: {
                        indicator: "$_id.indicatorName",
                        count:  "$indicatorNameCount"
                    },
                },
            }
        }
    ]);
    if(strategyIndicatorSideLogs.length === 0) await redisCtrl.setAdminDashBoardData('strategyIndicatorStatus', result, exchange);
    for(const strategyIndicatorSideLog of strategyIndicatorSideLogs){
        result[strategyIndicatorSideLog._id] = strategyIndicatorSideLog['indicators'];
    }
    await redisCtrl.setAdminDashBoardData('strategyIndicatorStatus', result, exchange);
};




module.exports = (connectionPool) => {
    return connectionPool.model('StrategyIndicatorLog', strategyIndicatorLogSchema);
};





