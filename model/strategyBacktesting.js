'use strict';

const { DataTypes, Deferrable } = require('sequelize');
const { BaseModel } = require('./base');
const model = require('./internal');

const strategyBacktestingAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    userId: {type: DataTypes.UUID, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    strategyId: {type: DataTypes.UUID, references: {model: 'Strategies', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    exchange: {type: DataTypes.STRING},
    symbol: {type: DataTypes.STRING, allowNull: false},
    period: {type: DataTypes.STRING, allowNull: false},
    startDate: {type: DataTypes.STRING, allowNull: false},
    endDate: {type: DataTypes.STRING, allowNull: false},
    trasactions: {type: DataTypes.JSON,  defaultValue: []},
    earningsRatio: DataTypes.FLOAT,
    maxRatio: DataTypes.FLOAT,
    minRatio: DataTypes.FLOAT,
    winningRatio: DataTypes.FLOAT,
    winCount: DataTypes.INTEGER,
    loseCount: DataTypes.INTEGER
};

class StrategyBacktestingModel extends BaseModel {
     constructor(...args) {
         super(...args);
     }

     static initModel(sequelize) {
         StrategyBacktestingModel.init(strategyBacktestingAttributes, {sequelize, modelName: 'StrategyBackTesting', indexes: [{unique: false, fields:['userId', 'strategyId']}]});
     }
    static relationModel() {
        StrategyBacktestingModel.belongsTo(model.User, {foreignKey:'userId'});
        StrategyBacktestingModel.belongsTo(model.Strategy, {foreignKey: "strategyId"});
    }

     static async makeNew(userId, strategyId, backtestingResult, exchange) {
         /*
         TODO : backtestingResult Validation check
          */
         const backtestingResultForm = {
             userId: userId,
             strategyId: strategyId,
             exchange: exchange,
             symbol: backtestingResult.symbol,
             period: backtestingResult.period,
             startDate: backtestingResult.startDate,
             endDate: backtestingResult.endDate,
             transaction: backtestingResult.transaction,
             earningsRatio: backtestingResult.earningsRatio,
             maxRatio: backtestingResult.maxRatio,
             minRatio: backtestingResult.minRatio,
             winningRatio: backtestingResult.winningRatio,
             winCount: backtestingResult.winCount,
             loseCount: backtestingResult.loseCount
         };
         const strategyBacktestingModel = StrategyBacktestingModel.build(backtestingResultForm);
         await strategyBacktestingModel.save();
         return strategyBacktestingModel;
     }
}

module.exports = StrategyBacktestingModel;