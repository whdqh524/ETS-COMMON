'use strict';

const { DataTypes, Deferrable, Op } = require('sequelize');
const BaseModel = require('../base').BaseModel;
const model = require('../internal');


const emailAttributes = {
    id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true},
    adminId: {type: DataTypes.UUID, references: {model: 'AdminUsers', key: 'id', deferrable: Deferrable.INITIALLY_DEFERRED()}},
    adminName:{type: DataTypes.STRING, allowNull: false}, // 어드민 이름
    code: {type: DataTypes.STRING, allowNull: false}, //이메일 코드
    language:{type: DataTypes.STRING, allowNull: false}, // 언어 코드
    title:{type: DataTypes.STRING, allowNull: false}, // 제목
    condition: {type: DataTypes.STRING, allowNull: false}, // 조건 이름
    content:{type: DataTypes.TEXT, allowNull: false}, // email 내용
};



class EmailModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        EmailModel.init(emailAttributes, {
            sequelize,
            modelName: 'Email',
            indexes:[
                {
                    fields: ['code', 'language','title']
                }
            ]
        });
    }

    static relationModel() {
        EmailModel.belongsTo(model.AdminUser, {as: 'adminUser', foreignKey:"adminId"});
    }

    static async makeNew(emailInfo, adminId, adminName) {
        const emailForm = {
            adminId: adminId,
            adminName: adminName,
            title: emailInfo.title,
            code: emailInfo.code,
            language: emailInfo.language,
            condition: emailInfo.condition,
            content: emailInfo.content,
        };
        return EmailModel.build(emailForm);

    }

    static async getAllFilterSearchEmailList(requestQuery){
        const {id, title, code, language} = requestQuery;
        const pageSize = requestQuery.pageSize ? requestQuery.pageSize : 20;
        const pageNumber = requestQuery.pageNumber ? requestQuery.pageNumber : 1;
        const offset = ((pageNumber - 1) * pageSize);
        let emailWhereQuery = {};

        if(id || code || title){
            const result = [];
            emailWhereQuery = id ? {id: id} : code ? {code: code} : {title: title};
            const emailModel = await model['Email'].findOne({where: emailWhereQuery});
            if(!emailModel) return [result, 0];
            result.push(emailModel);
            return [result, 1];
        }

        emailWhereQuery.language = {[Op.in]: JSON.parse(language)};
        const emailModel = await model['Email'].findAll({
            where: emailWhereQuery,
            offset: offset,
            limit: pageSize,
            order: [['createdAt', 'DESC']],
        });
        const emailCount = await model['Email'].count({where: emailWhereQuery});

        return [emailModel, emailCount];
    }

    async modify(emailInfo){
        this.code = emailInfo.code;
        this.language = emailInfo.language;
        this.condition = emailInfo.condition;
        this.title = emailInfo.title;
        this.content = emailInfo.content;
        return await this.save()
    }

}

module.exports = EmailModel;