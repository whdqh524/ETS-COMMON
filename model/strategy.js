'use strict';

const { DataTypes, Deferrable, Op } = require('sequelize');
const { BaseModel } = require('./base');
const model = require('./internal');
const { IndicatorValidationError } = require('../modules/error');

const hideIndicator = ['stoch', 'atr_trailing_stop'];
const hideIndicatorMap = {
    'stoch' : 'coinbutler_pick_1',
    'atr_trailing_stop' : 'coinbutler_pick_2'
};
const strategyAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    userId: {type: DataTypes.UUID, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    name: {type: DataTypes.STRING, allowNull: false},
    direction: {type: DataTypes.STRING, allowNull: false},
    openInfo: {type: DataTypes.JSON, defaultValue: []},
    takeProfitInfo: {type: DataTypes.JSON, defaultValue: []},
    stopLossInfo: {type: DataTypes.JSON, defaultValue:{}},
    trailingInfo: {type: DataTypes.JSON, defaultValue:{}},
    isAlive: {type: DataTypes.BOOLEAN, allowNull:false, defaultValue:true}
};

class StrategyModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        StrategyModel.init(strategyAttributes, {sequelize, modelName: 'Strategy', indexes: [{unique: false, fields:['userId']}]});
    }

    static relationModel() {
        StrategyModel.hasMany(model.OrderPlan, {as: 'orderPlans', foreignKey:"strategyId"});
        StrategyModel.hasMany(model.StrategyBacktesting, {as:'backtestingResults', foreignKey:"strategyId"});
        StrategyModel.belongsTo(model.User, {foreignKey:"userId"});
    }

    static async makeNew(strategyInfo, user, exchange) {
        StrategyModel.checkIndicatorValidation(strategyInfo.openInfo);
        StrategyModel.checkIndicatorValidation(strategyInfo.takeProfitInfo);
        StrategyModel.checkIndicatorValidation(strategyInfo.stopLossInfo);
        const orderPlanForm = {
            userId: user.id,
            name: strategyInfo.name,
            direction: strategyInfo.direction,
            openInfo: strategyInfo.openInfo,
            takeProfitInfo: strategyInfo.takeProfitInfo,
            stopLossInfo: strategyInfo.stopLossInfo,
            trailingInfo: strategyInfo.trailingInfo ? strategyInfo.trailingInfo : {}
        };
        const strategyModel = StrategyModel.build(orderPlanForm);
        await strategyModel.save();
        if(strategyInfo.backtestingResult) {
            await model.StrategyBacktesting.makeNew(user.id, strategyModel.id, strategyInfo.backtestingResult, exchange);
        }
        return strategyModel;
    }

    convertReturnForm() {
        const [openInfo, takeProfitInfo] = this.convertIndicatorForm();
        const result = {
            id: this.id,
            userId: this.userId,
            name: this.name,
            direction: this.direction,
            openInfo: openInfo,
            takeProfitInfo: takeProfitInfo,
            stopLossInfo: this.stopLossInfo,
            trailingInfo: this.trailingInfo,
            isAlive: this.isAlive,
            createdAt: this.createdAt
        };
        if(this['backtestingResults']) {
            result['backtestingResults'] = this.backtestingResults;
        }
        return result;
    }

    convertIndicatorForm() {
        const [openInfo, takeProfitInfo] = [[], []];
        for(const info of this.openInfo) {
            for(const indicator of info.indicators) {
                if(hideIndicator.includes(indicator.name)) {
                    indicator.name = hideIndicatorMap[indicator.name];
                }
            }
            openInfo.push(info);
        }
        for(const info of this.takeProfitInfo) {
            for(const indicator of info.indicators) {
                if(hideIndicator.includes(indicator.name)) {
                    indicator.name = hideIndicatorMap[indicator.name];
                }
            }
            takeProfitInfo.push(info);
        }
        return [openInfo, takeProfitInfo]
    }

    static async getStrategyListByUserId(userId) {
        const strategyList = await StrategyModel.findAll({
            where: {
                userId: userId,
                isAlive: true
            },
            include: [{
                model: model['StrategyBacktesting'],
                as: 'backtestingResults'
            }],
            order: [['createdAt', 'DESC']]
        });
        return strategyList.map((strategyModel) => {return strategyModel.convertReturnForm()});
    }

    async modify(strategyInfo) {
        StrategyModel.checkIndicatorValidation(strategyInfo.openInfo);
        StrategyModel.checkIndicatorValidation(strategyInfo.takeProfitInfo);
        StrategyModel.checkIndicatorValidation(strategyInfo.stopLossInfo);
        this.direction = strategyInfo.direction;
        this.openInfo = strategyInfo.openInfo;
        this.takeProfitInfo = strategyInfo.takeProfitInfo;
        this.stopLossInfo = strategyInfo.stopLossInfo;
        this.trailingInfo = strategyInfo.trailingInfo ? strategyInfo.trailingInfo : {};
        await model.StrategyBacktesting.makeNew(this.id, strategyInfo.backtestingResult);
        await this.save();
    }

    async removeStrategy() {
        this.isAlive = false;
        await this.save();
    }

    static checkIndicatorValidation(indicatorInfo) {
        if(!Array.isArray(indicatorInfo)) {
            throw new IndicatorValidationError(`IndicatorInfo Form Error`);
        }
        for (const info of indicatorInfo) {
            if(info['stopLossPercent']) {
                if(parseFloat(info['stopLossPercent']) < 0 || parseFloat(info['stopLossPercent']) >= 1) {
                    throw new IndicatorValidationError(`Invalid stopLossPercent`);
                }
                continue;
            }
            const indicators = info.indicators;
            const side = info.side;
            indicators.map(indicator => {
                if(typeof indicator != 'object') {
                    throw new IndicatorValidationError(`Indicator Type is not object - ${indicator}`)
                }
                if(indicator['takeProfitPercent']) {
                    if(parseFloat(indicator['takeProfitPercent']) < 0) {
                        throw new IndicatorValidationError(`Invalid takeProfitPercent`);
                    }
                    return;
                }
                if(!indicator.name) {
                    throw new IndicatorValidationError(`Indicator don't have name - ${indicator}`);
                }
                if(!indicator.candleSize || ![15,30,60,240,1440].includes(parseInt(indicator.candleSize))) {
                    throw new IndicatorValidationError(`Indicator candleSize is wrong - ${indicator.candleSize}, available : [15,30,60,240,1440]`)
                }
                switch (indicator.name) {
                    case "macd":
                        if(!indicator.fastMaPeriod || parseInt(indicator.fastMaPeriod) < 2 || parseInt(indicator.fastMaPeriod) > 100 || parseInt(indicator.fastMaPeriod) != Number(indicator.fastMaPeriod)) {
                            throw new IndicatorValidationError(`MACD-fastMaPeriod validate error : ${indicator.fastMaPeriod}, 2~100, int`);
                        }
                        if(!indicator.slowMaPeriod || parseInt(indicator.slowMaPeriod) < 2 || parseInt(indicator.slowMaPeriod) > 100 || parseInt(indicator.slowMaPeriod) != Number(indicator.slowMaPeriod)) {
                            throw new IndicatorValidationError(`MACD-slowMaPeriod validate error : ${indicator.slowMaPeriod}, 2~100, int`);
                        }
                        if(parseInt(indicator.fastMaPeriod) >= parseInt(indicator.slowMaPeriod)) {
                            throw new IndicatorValidationError(`MACD-slowMaPeriod must bigger than fastMaPeriod`);
                        }
                        if(!indicator.signalPeriod || parseInt(indicator.signalPeriod) < 2 || parseInt(indicator.signalPeriod) > 100 || parseInt(indicator.signalPeriod) != Number(indicator.signalPeriod)) {
                            throw new IndicatorValidationError(`MACD-signalPeriod validate error : ${indicator.signalPeriod}, 2~100, int`);
                        }
                        break;
                    case "ema_cross":
                        if(!indicator.shortPeriod || parseInt(indicator.shortPeriod) < 1 || parseInt(indicator.shortPeriod) > 100 || parseInt(indicator.shortPeriod) != Number(indicator.shortPeriod)) {
                            throw new IndicatorValidationError(`EMA_CROSS-shortPeriod validate error : ${indicator.shortPeriod}, 1~100, int`);
                        }
                        if(!indicator.longPeriod || parseInt(indicator.longPeriod) < 10 || parseInt(indicator.longPeriod) > 200 || parseInt(indicator.longPeriod) != Number(indicator.longPeriod)) {
                            throw new IndicatorValidationError(`EMA_CROSS-longPeriod validate error : ${indicator.longPeriod}, 10~200, int`);
                        }
                        if(parseInt(indicator.shortPeriod) >= parseInt(indicator.longPeriod)) {
                            throw new IndicatorValidationError(`EMA_CROSS-longPeriod must bigger than shortPeriod`);
                        }
                        break;
                    case "rsi":
                        if(!indicator.period || parseInt(indicator.period) < 2 || parseInt(indicator.period) > 100 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`RSI-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(side == "SELL" && (!indicator.overValue || parseInt(indicator.overValue) < 60 || parseInt(indicator.overValue) > 100 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`RSI-value(overBought) validate error : ${indicator.overValue}, 60~100, int`);
                        }
                        if(side == "BUY" && (!indicator.overValue || parseInt(indicator.overValue) < 1 || parseInt(indicator.overValue) > 40 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`RSI-value(overSold) validate error : ${indicator.overValue}, 1~40, int`);
                        }
                        break;
                    case "mfi":
                        if(!indicator.period || parseInt(indicator.period) < 2 || parseInt(indicator.period) > 100 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`MFI-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(side == "SELL" && (indicator.overValue == undefined || parseInt(indicator.overValue) < 60 || parseInt(indicator.overValue) > 100 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`MFI-value(overBounght) validate error : ${indicator.overValue}, 60~100, int`);
                        }
                        if(side == "BUY" && (!indicator.overValue || parseInt(indicator.overValue) < 1 || parseInt(indicator.overValue) > 40 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`MFI-value(overSold) validate error : ${indicator.overValue}, 1~40, int`);
                        }
                        break;
                    case "bollinger_band":
                        if(!indicator.period || parseInt(indicator.period) < 2 || parseInt(indicator.period) > 100 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`BOLLINGER_BAND-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(!indicator.deviations || parseInt(indicator.deviations) < 1 || parseInt(indicator.deviations) > 50 || parseInt(indicator.deviations) != Number(indicator.deviations)) {
                            throw new IndicatorValidationError(`BOLLINGER_BAND-deviations validate error : ${indicator.deviations}, 1~50, int`);
                        }
                        if(indicator.band == undefined || ![-1, 0, 1].includes(parseInt(indicator.band))) {
                            throw new IndicatorValidationError(`BOLLINGER_BAND-band validate error : ${indicator.band}, [-1,0,1]`);
                        }
                        break;
                    case "vma":
                        if(!indicator.period || parseInt(indicator.period) < 20 || parseInt(indicator.period) > 250 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`VMA-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(!indicator.rate || parseInt(indicator.rate) < 100 || parseInt(indicator.rate) > 300 || parseInt(indicator.rate) != Number(indicator.rate)) {
                            throw new IndicatorValidationError(`VMA-rate validate error : ${indicator.rate}, 100~300, int`);
                        }
                        break;
                    case "obv_cross":
                        if(!indicator.shortPeriod || parseInt(indicator.shortPeriod) < 1 || parseInt(indicator.shortPeriod) > 15 || parseInt(indicator.shortPeriod) != Number(indicator.shortPeriod)) {
                            throw new IndicatorValidationError(`OBV_CROSS-shortPeriod validate error : ${indicator.shortPeriod}, 1~15, int`);
                        }
                        if(!indicator.longPeriod || parseInt(indicator.longPeriod) < 10 || parseInt(indicator.longPeriod) > 30 || parseInt(indicator.longPeriod) != Number(indicator.longPeriod)) {
                            throw new IndicatorValidationError(`OBV_CROSS-longPeriod validate error : ${indicator.longPeriod}, 10~30, int`);
                        }
                        if(parseInt(indicator.shortPeriod) >= parseInt(indicator.longPeriod)) {
                            throw new IndicatorValidationError(`EMA_CROSS-longPeriod must bigger than shortPeriod`);
                        }
                        break;
                    case "vma_cross":
                        if(!indicator.shortPeriod || parseInt(indicator.shortPeriod) < 1 || parseInt(indicator.shortPeriod) > 15 || parseInt(indicator.shortPeriod) != Number(indicator.shortPeriod)) {
                            throw new IndicatorValidationError(`VMA_CROSS-shortPeriod validate error : ${indicator.shortPeriod}, 1~15, int`);
                        }
                        if(!indicator.longPeriod || parseInt(indicator.longPeriod) < 10 || parseInt(indicator.longPeriod) > 30 || parseInt(indicator.longPeriod) != Number(indicator.longPeriod)) {
                            throw new IndicatorValidationError(`VMA_CROSS-longPeriod validate error : ${indicator.longPeriod}, 10~30, int`);
                        }
                        if(parseInt(indicator.shortPeriod) >= parseInt(indicator.longPeriod)) {
                            throw new IndicatorValidationError(`VMA_CROSS-longPeriod must bigger than shortPeriod`);
                        }
                        break;
                    case "supertrend":
                        if(!indicator.period || parseInt(indicator.period) < 2 || parseInt(indicator.period) > 30 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`SUPER_TREND-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(!indicator.multiplier || parseFloat(indicator.multiplier) < 1.0 || parseFloat(indicator.multiplier) > 10.0) {
                            throw new IndicatorValidationError(`SUPER_TREND-multiplier validate error : ${indicator.multiplier}, 1.0~10.0, float`);
                        }
                        break;
                    case "tii":
                        if(!indicator.period || parseInt(indicator.period) < 2 || parseInt(indicator.period) > 100 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`TII-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(!indicator.signalPeriod || parseInt(indicator.signalPeriod) < 2 || parseInt(indicator.signalPeriod) > 100 || parseInt(indicator.signalPeriod) != Number(indicator.signalPeriod)) {
                            throw new IndicatorValidationError(`TII-signalPeriod validate error : ${indicator.signalPeriod}, 2~100, int`);
                        }
                        if(side == "SELL" && (!indicator.overValue || parseInt(indicator.overValue) < 60 || parseInt(indicator.overValue) > 100 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`TII-value(overBought) validate error : ${indicator.overValue}, 60~100, int`);
                        }
                        if(side == "BUY" && (!indicator.overValue || parseInt(indicator.overValue) < 1 || parseInt(indicator.overValue) > 40 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`TII-value(overSold) validate error : ${indicator.overValue}, 1~40, int`);
                        }
                        break;
                    case "coinbutler_pick_1":
                        if(!indicator.kPeriod || parseInt(indicator.kPeriod) < 2 || parseInt(indicator.kPeriod) > 100 || parseInt(indicator.kPeriod) != Number(indicator.kPeriod)) {
                            throw new IndicatorValidationError(`STOCH-kPeriod validate error : ${indicator.kPeriod}, 2~100, int`);
                        }
                        if(!indicator.smoothK || parseInt(indicator.smoothK) < 2 || parseInt(indicator.smoothK) > 100 || parseInt(indicator.smoothK) != Number(indicator.smoothK)) {
                            throw new IndicatorValidationError(`STOCH-smoothK validate error : ${indicator.smoothK}, 2~100, int`);
                        }
                        if(!indicator.dPeriod || parseInt(indicator.dPeriod) < 2 || parseInt(indicator.dPeriod) > 100 || parseInt(indicator.dPeriod) != Number(indicator.dPeriod)) {
                            throw new IndicatorValidationError(`STOCH-dPeriod validate error : ${indicator.dPeriod}, 2~100, int`);
                        }
                        if(side == "SELL" && (!indicator.overValue || parseInt(indicator.overValue) < 60 || parseInt(indicator.overValue) > 100 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`STOCH-value(overBounght) validate error : ${indicator.overValue}, 60~100, int`);
                        }
                        if(side == "BUY" && (!indicator.overValue || parseInt(indicator.overValue) < 1 || parseInt(indicator.overValue) > 40 || parseInt(indicator.overValue) != Number(indicator.overValue))) {
                            throw new IndicatorValidationError(`STOCH-value(overSold) validate error : ${indicator.overValue}, 1~40, int`);
                        }
                        indicator.name = 'stoch';
                        break;
                    case "coinbutler_pick_2":
                        if(!indicator.period || parseInt(indicator.period) < 2 || parseInt(indicator.period) > 30 || parseInt(indicator.period) != Number(indicator.period)) {
                            throw new IndicatorValidationError(`ATR_TRAILING_STOP-period validate error : ${indicator.period}, 2~100, int`);
                        }
                        if(!indicator.multiplier || parseFloat(indicator.multiplier) < 1.0 || parseFloat(indicator.multiplier) > 10.0) {
                            throw new IndicatorValidationError(`ATR_TRAILING_STOP-multiplier validate error : ${indicator.multiplier}, 1.0~10.0, float`);
                        }
                        if(indicator.highlow == undefined || !(indicator.highlow == true || indicator.highlow == false)) {
                            throw new IndicatorValidationError(`ATR_TRAILING_STOP-highlow validate error : ${indicator.highlow}, only true or false`);
                        }
                        indicator.name = 'atr_trailing_stop';
                        break;
                }
            });
        }
    }
}

module.exports = StrategyModel;