'use strict';

const { DataTypes } = require('sequelize');
const { BaseModel } = require('./base');

const slippageAttributes = {
    minimumPrice: {type: DataTypes.FLOAT, allowNull: false},
    maximumPrice: {type: DataTypes.FLOAT, allowNull: false},
    slippage: {type: DataTypes.FLOAT, allowNull: false}
};

class SlippageModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        SlippageModel.init(slippageAttributes, {sequelize, modelName: 'Slippage', timestamps:false});
    }
}

module.exports = SlippageModel;