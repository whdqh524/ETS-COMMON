'use strict';

const { DataTypes, Deferrable, Op } = require('sequelize');
const BaseModel = require('../base').BaseModel;
const model = require('../internal');


const layerNoticeAttributes = {
    id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true}, // 고유 아이디
    adminId: {type: DataTypes.UUID, references: {model: 'AdminUsers', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    exchange:{type: DataTypes.STRING},
    title:{type: DataTypes.STRING, allowNull: false}, // 레이어 이름
    adminName: {type: DataTypes.STRING, allowNull: false}, // 어드민 이름
    imageLocation:{type: DataTypes.STRING, allowNull: false}, // 보여주는 이미지 주소
    imageName:{type: DataTypes.STRING, allowNull: false},
    url:{type: DataTypes.STRING, allowNull: false}, // 링크
    language:{type: DataTypes.STRING, allowNull: false}, // 국가 코드
    startDate:{type:DataTypes.BIGINT, allowNull: false}, // 시작 시간
    endDate:{type:DataTypes.BIGINT, allowNull: false},  // 끝나는 시간
};


class LayerNoticeModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        LayerNoticeModel.init(layerNoticeAttributes, {
            sequelize,
            modelName: 'LayerNotice',
            indexes: [{unique: false, fields:['exchange','title','language']}]
        });
    }

    static relationModel() {
        LayerNoticeModel.belongsTo(model.AdminUser, {as: 'adminUser', foreignKey:"adminId"});
    }

    static async makeNew(layerInfo, adminId, adminName, imageLocation, imageName){
        const parseStartDate = parseInt(layerInfo.startTime);
        const parseEndDate = parseInt(layerInfo.endTime);
        const layerForm = {
            adminId: adminId,
            exchange: layerInfo.exchange,
            adminName: adminName,
            title: layerInfo.title,
            language: layerInfo.language,
            imageLocation: imageLocation,
            imageName: imageName,
            url: layerInfo.url,
            startDate: parseStartDate,
            endDate: parseEndDate,
        };
        return LayerNoticeModel.build(layerForm);
    }

    convertLayerInfoForm() {
        return {
            id:this.id,
            exchange: this.exchange,
            url: this.url,
            imageLocation: this.imageLocation
        }
    }

    static async getActivatedLayer(language='ko') {  // TODO : exchange 받아서 처리해야 함
        const nowDate = new Date().getTime();
        const layerList = await LayerNoticeModel.findAll({
            where: {
                startDate: {[Op.lte]: nowDate},
                endDate: {[Op.gte]: nowDate},
                language: language
            }
        });
        return layerList.map(layer => {return layer.convertLayerInfoForm();})
    }
}

module.exports = LayerNoticeModel;