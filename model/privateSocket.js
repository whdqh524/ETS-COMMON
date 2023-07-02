'use strict';

const { DataTypes, Deferrable } = require('sequelize');

const { BaseModel } = require('./base');
const model = require('./internal');

const privateSocketAttributes = {
    id: {type: DataTypes.UUID, defaultValue:DataTypes.UUIDV4, primaryKey:true},
    userId: {type: DataTypes.UUID, allowNull: false, references: {model: 'Users', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    apiKey: {type: DataTypes.STRING, allowNull: false},
    exchange: {type: DataTypes.STRING(10), allowNull: false},
    ip: {type: DataTypes.STRING, allowNull: false},
    isAlive: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true}
};

class PrivateSocketModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        PrivateSocketModel.init(privateSocketAttributes, {sequelize, modelName: 'PrivateSocket', indexes: [{unique: true, fields: ['exchange', 'ip', 'userId']}, {unique: true, fields: ['apiKey']}]});
    }

    static relationModel() {
        PrivateSocketModel.belongsTo(model.User, {foreignKey:"userId"});
    }

    static async findAllServerList(exchangeName, zkServerList) {
        const orderedServerList = await this.findAll({
            where: {
                exchange: exchangeName,
                ip: {
                    [ model.Sequelize.Op.in ]: zkServerList
                }
            },
            attributes: ['ip', [ model.Sequelize.fn('count', '*'), 'count' ]],
            group: 'ip',
            order:['count']
        });
        const orderedServerIpList = [];
        orderedServerList.map(orderedSeverInfo => {
            orderedServerIpList.push(orderedSeverInfo.ip);
        });
        for(const aliveSocket of zkServerList) {
            if(!orderedServerIpList.includes(aliveSocket)) {
                orderedServerList.push({ip:aliveSocket, count:0});
            }
        }
        const sortedServerList = orderedServerList.sort(function (a, b) {
            return a.count - b.count;
        });
        return sortedServerList;
    }
}

module.exports = PrivateSocketModel;