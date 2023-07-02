'use strict';

const { DataTypes } = require('sequelize');
const BaseModel = require('../base').BaseModel;
const crypto = require('crypto');
const model = require('../internal');
const redisCtrl = require('../../modules/redisCtrl');
const { NotFindUserError, InvalidPasswordError, AuthTokenExpiredError } = require('../../modules/error');


const adminUserAttributes = {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    accountId: {type: DataTypes.STRING, allowNull: false},
    name: {type: DataTypes.STRING, allowNull: false},
    password: {type: DataTypes.STRING, allowNull: false},
    position: {type: DataTypes.STRING, allowNull: false},
    status: {type: DataTypes.STRING, defaultValue:'ALIVE'},
    salt: {type: DataTypes.STRING},
    authorityInfo: {type: DataTypes.JSON},
};



class AdminUserModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        AdminUserModel.init(adminUserAttributes, {
            sequelize,
            modelName: 'AdminUser',
            indexes: [
                {
                    fields:['accountId'],
                    unique: true,
                },
                {
                    fields:['name'],
                    unique: true,
                }
            ]
        });
        AdminUserModel.beforeCreate(AdminUserModel.setSaltAndPassword);
        AdminUserModel.beforeUpdate(AdminUserModel.setSaltAndPassword);
    }

    static relationModel() {
        AdminUserModel.hasMany(model.Email, {as: 'emails', foreignKey:"adminId"});
        AdminUserModel.hasMany(model.Telegram, {as: 'telegrams', foreignKey:"adminId"});
        AdminUserModel.hasMany(model.RollingNotice, {as: 'rollingNotices', foreignKey:"adminId"});
        AdminUserModel.hasMany(model.LayerNotice, {as: 'layerNotices', foreignKey:"adminId"});
    }

    static async makeNew(requestBody){
        let adminForm = {
            accountId: requestBody.accountId,
            password: requestBody.password,
            name: requestBody.name,
            position: requestBody.position,
            authorityInfo: requestBody.authorityInfo,
        };
        return AdminUserModel.build(adminForm);
    }

    static generateSalt() {
        return crypto.randomBytes(16).toString( 'base64');
    }

    static encryptPassword(plainText, salt){
        return crypto
            .createHash ( 'RSA-SHA256')
            .update (plainText)
            .update (salt)
            .digest ( 'hex')
    }

    static setSaltAndPassword(admin){
        if(!admin.salt) {
            admin.salt = AdminUserModel.generateSalt();
        }
        if (admin.changed('password')){
            admin.password = AdminUserModel.encryptPassword(admin.password, admin.salt)
        }
    }

    validatePassword(enteredPassword) {
        return AdminUserModel.encryptPassword(enteredPassword, this.salt) === this.password
    }

    static async signInByAccountIdAndPassword(accountId, password) {
        const adminUserModel = await AdminUserModel.findOne({where: {accountId: accountId}});
        if(!adminUserModel) throw new NotFindUserError();
        if(!adminUserModel.validatePassword(password)) throw new InvalidPasswordError();
        return adminUserModel;
    }

    convertInfoForm() {
        return {
            id: this.id,
            accountId: this.accountId,
            adminName: this.name,
            position: this.position,
            authorityInfo: this.authorityInfo,
        }
    }

    static async getFindOneAdminAccountId(accountId) {
        return await model['AdminUser'].findOne({where:{accountId: accountId}});
    }

    static async signInByToken(token) {
        const adminInfo = await redisCtrl.getAdminSession(token);
        if(!adminInfo) throw new AuthTokenExpiredError();
        return await model['AdminUser'].findOne({where:{accountId: adminInfo.accountId}});
    }

    static async updatePassword(token, oldPassword, password){
        const adminUserInfo = await redisCtrl.getAdminSession(token);
        const adminUserModel = await AdminUserModel.findByPk(adminUserInfo.accountId);
        await adminUserModel.validatePassword(oldPassword);
        adminUserModel.password = password;
        await adminUserModel.save();
        return await redisCtrl.delAdminSession(token);
    }
}

module.exports = AdminUserModel;