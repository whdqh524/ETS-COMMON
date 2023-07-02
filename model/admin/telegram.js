'use strict';

const { DataTypes, Deferrable, Op } = require('sequelize');
const BaseModel = require('../base').BaseModel;
const model = require('../internal');



const telegramAttributes = {
    id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true},
    adminId: {type: DataTypes.UUID, references: {model: 'AdminUsers', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    adminName: {type: DataTypes.STRING, allowNull: false}, // 등록한 어드민 이름
    code: {type: DataTypes.STRING, allowNull: false}, // 텔레그램 만드는 고유의 키 system + type + action
    language: {type: DataTypes.STRING, allowNull: false}, // 언어 코드
    condition: {type: DataTypes.STRING, allowNull: false},  //조건 이름
    title: {type: DataTypes.STRING, allowNull: false},  // 제목
    content: {type: DataTypes.TEXT, allowNull: false}, // 텔레그램 메세지 내용
};


class TelegramModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        TelegramModel.init(telegramAttributes, {
            sequelize,
            modelName: 'Telegram',
            indexes: [{
                    unique: true,
                    fields: ['code', 'language']
                },
                {
                    fields: ['title']
                }
            ]
        });
    };

    static async makeNew(telegramInfo, adminId, adminName){
        const telegramForm = {
            adminId: adminId,
            code: `${telegramInfo.system}-${telegramInfo.type}-${telegramInfo.action}`,
            language: telegramInfo.language,
            adminName: adminName,
            condition: telegramInfo.condition,
            title: telegramInfo.title,
            content: telegramInfo.content
        };

        return TelegramModel.build(telegramForm);

    };

    static relationModel() {
        TelegramModel.belongsTo(model.AdminUser, {as: 'adminUser', foreignKey:"adminId"});
    }

    static async getAllFilterSearchTelegramList(requestQuery){
        const {id, code, title, language} = requestQuery;
        const pageSize = requestQuery.pageSize ? requestQuery.pageSize : 20;
        const pageNumber = requestQuery.pageNumber ? requestQuery.pageNumber : 1;
        const offset = ((pageNumber - 1) * pageSize);
        let telegramWhereQuery = {};
        if(id || code || title){
            const result = [];
            telegramWhereQuery = id ? {id: id} : code ? {code: code} : {title: title};
            const telegramModel = await model['Telegram'].findOne({where: telegramWhereQuery});
            if(!telegramModel) return [result, 0];
            result.push(telegramModel);
            return [result, 1];
        }

        telegramWhereQuery.language = {[Op.in]: JSON.parse(language)};
        const telegramModel = await model['Telegram'].findAll({
            where: telegramWhereQuery,
            offset: offset,
            limit: pageSize,
            order: [['createdAt', 'DESC']],
        });
        const telegramCount = await model['Telegram'].count({where: telegramWhereQuery});
        return [telegramModel, telegramCount];
    };

    async modify(telegramInfo){
        this.code = `${telegramInfo.system}-${telegramInfo.type}-${telegramInfo.action}`;
        this.language = telegramInfo.language;
        this.condition = telegramInfo.condition;
        this.title = telegramInfo.title;
        this.content = telegramInfo.content;
        return await this.save()
    }
}

module.exports = TelegramModel;