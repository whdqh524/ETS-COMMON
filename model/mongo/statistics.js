const mongoose = require('mongoose');
const mSchema = mongoose.Schema;
const redisCtrl = require('../../modules/redisCtrl');
const config = require('../../config');

const statisticsSchema = new mongoose.Schema({
    type: {type: String},
    exchange: {type: String},
    content:{type: mSchema.Types.Mixed},
    createdAt: {type: Date},
}, {minimize: false});

statisticsSchema.index({exchange: 1, type: -1});
statisticsSchema.index({createdAt: 1});

const publicSaveList = ['userStatus', 'userSignUpCountryStatus', 'userSignOutReasonStatus', 'errorCount'];
const exchangeSaveList = ['orderPlanStatus', 'marketStatus', 'strategyIndicatorStatus'];

statisticsSchema.statics.makeNew = async function(){
    const statisticsSaveForm = [];
    const publicData = await redisCtrl.getAdminDashBoardDataByMultiField(publicSaveList);
    const createdAt = new Date().setDate(new Date().getDate() - 1);

    publicData.forEach((dashBoardData, index) => {
        if(dashBoardData){
            statisticsSaveForm.push({
                type: publicSaveList[index],
                exchange: 'public',
                content: dashBoardData,
                createdAt: createdAt,
            });
        }
    });

    for(const exchange of config.exchangeList){
        const exchangeData = await redisCtrl.getAdminDashBoardDataByMultiField(exchangeSaveList, exchange);
        exchangeData.forEach((dashBoardData, index) => {
            statisticsSaveForm.push({
                type: exchangeSaveList[index],
                exchange: exchange,
                content: dashBoardData,
                createdAt: createdAt,
            });
        });
    }
    await this.insertMany(statisticsSaveForm);
};

statisticsSchema.statics.delete = async function(){
    await redisCtrl.delAdminDashBoardData(publicSaveList);
    for(const exchange of exchangeSaveList){
        await redisCtrl.delAdminDashBoardData(exchangeSaveList, exchange);
    }
};

module.exports = (connectionPool) => {
    return connectionPool.model('statistics', statisticsSchema);
};





