'use strict';

const { DataTypes, Deferrable, Op } = require('sequelize');
const BaseModel = require('../base').BaseModel;
const model = require('../internal');


const rollingNoticeAttributes = {
    id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true},
    adminId: {type: DataTypes.UUID, references: {model: 'AdminUsers', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    adminName: {type: DataTypes.STRING, allowNull: false}, // 등록한 어드민 이름
    exchange: {type: DataTypes.STRING}, // 거래소
    title: {type: DataTypes.STRING, allowNull: false}, // 제목
    status: {type: DataTypes.STRING, allowNull: false}, //ACTIVE, INACTIVE
    language: {type: DataTypes.STRING, allowNull: false}, // 언어코드
    url: {type: DataTypes.STRING, allowNull: false}, // 주소
    content: {type: DataTypes.TEXT, allowNull: false}, // rolling 내용
};

class RollingNoticeModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        RollingNoticeModel.init(rollingNoticeAttributes, {
            sequelize,
            modelName: 'RollingNotice',
            indexes: [{fields:['exchange', 'title', 'status', 'language']}]
        });
    }

    static relationModel() {
        RollingNoticeModel.belongsTo(model.AdminUser, {as: 'adminUser', foreignKey:"adminId"});
    }

    static async makeNew(rollingInfo, adminId ,adminName){
        let rollingForm = {
            adminId: adminId,
            adminName: adminName,
            exchange: rollingInfo.exchange,
            title: rollingInfo.title,
            language: rollingInfo.language,
            url: rollingInfo.url,
            status: rollingInfo.status,
            content: rollingInfo.content,
        };
        return RollingNoticeModel.build(rollingForm);
    }


    convertRollingInfoForm() {
        return {
            id: this.id,
            exchange: this.exchange,
            url: this.url,
            content: this.content
        };
    }

    static async getActivatedRolling(language='ko') {
        const rollingList = await RollingNoticeModel.findAll({
            where: {
                status: 'ACTIVE',
                language: language
            }
        });
        return rollingList.map(rolling => {return rolling.convertRollingInfoForm();})
    }
}

module.exports = RollingNoticeModel;