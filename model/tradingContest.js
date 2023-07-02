'use strict';

const { DataTypes } = require('sequelize');
const { BaseModel } = require('./base');
const model = require('./internal');
const redisCtrl = require('../modules/redisCtrl');
const config = require('../config');

const tradingContestAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    startDate: {type: DataTypes.DATE, allowNull: false},
    endDate: {type: DataTypes.DATE, allowNull: false},
    contestType: {type: DataTypes.STRING, allowNull: false}
};

class TradingContestModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        TradingContestModel.init(tradingContestAttributes, {sequelize, modelName: 'TradingContest', timestamps:false});
    }

    static async getOngoingTradingContests() {
        const nowDate = new Date();
        const tradingContests = await TradingContestModel.findAll({
            where: {
                startDate:{
                    [model.Sequelize.Op.lte]:nowDate
                },
                endDate:{
                    [model.Sequelize.Op.gt]:nowDate
                }
            }
        });
        return tradingContests;
    }

    async recordTrading(user, score) {
        if(this.contestType === 'BestRateOfReturn') {
            return await this.recordTradingByBestRateOfReturn(user, this.exchange, score);
        }
        else if(this.contestType === 'TotalRateOfReturn') {
            return await this.recordTradingByTotalRateOfReturn(user, this.exchange, score);
        }
    }

    async recordTradingByBestRateOfReturn(user, exchangeName, score) {
        if(score <= 0) {
            return;
        }
        const scoreTable = `${exchangeName}:tradingContest:${this.id}`;
        const userInfo = `${user.userName}||${Date.now()}`;
        return await redisCtrl.addZscoreTable(scoreTable, userInfo, score);
    }

    async recordTradingByTotalRateOfReturn(user, exchangeName, symbol, amount) {
        const scoreTable = `${exchangeName}:tradingContest:${this.id}`;
        const quoteAsset = symbol.split('-')[1];
        const totalRate = amount / parseFloat(config.virtualInitBalance[quoteAsset]) * 100;
        const lastData = await redisCtrl.getRankZscoreTable(scoreTable, user.userName);
        if(lastData) {
            return await redisCtrl.incrementZscoreTable(scoreTable, user.userName, totalRate);
        }
        return await redisCtrl.addZscoreTable(scoreTable, user.userName, totalRate);
    }
}

module.exports = TradingContestModel;