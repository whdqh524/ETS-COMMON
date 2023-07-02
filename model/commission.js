'use strict';

const { DataTypes, Deferrable } = require('sequelize');
const { BaseModel } = require('./base');
const model = require('./internal');

const commissionAttributes = {
    orderPlanId: {type: DataTypes.UUID, references: {model: 'OrderPlans', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}, primaryKey:true},
    asset: {type: DataTypes.STRING(10), allowNull: false, primaryKey: true},
    qty: {type: DataTypes.FLOAT, allowNull: false},
    createdAt: {type: DataTypes.DATE, defaultValue: model.Sequelize.literal('CURRENT_TIMESTAMP(3)')},
    updatedAt: {type: DataTypes.DATE, defaultValue: model.Sequelize.literal('CURRENT_TIMESTAMP(3)')}
};

class CommissionModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        CommissionModel.init(commissionAttributes, {sequelize, modelName: 'Commission', indexes: [{unique: true, fields: ['orderPlanId','asset']}]});
    }

    static relationModel() {
        CommissionModel.belongsTo(model.OrderPlan, {foreignKey:"orderPlanId"});
    }

    static async makeNewCommissions(orderPlanId, commissionData){
        for(const asset in commissionData) {
            const queryString = `INSERT INTO "Commissions" ("orderPlanId", "asset", "qty") VALUES 
            ('${orderPlanId}', '${asset}', '${commissionData[asset]}') ON CONFLICT ("orderPlanId", "asset") 
            DO UPDATE SET qty = "Commissions"."qty" + excluded.qty;`;
            await model.sequelize.query(queryString, {model:CommissionModel, mapToModel:true});
        }
        return;
    }

}

module.exports = CommissionModel;