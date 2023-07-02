"use strict";

const { DataTypes, Op } = require('sequelize');
const { BaseModel } = require('./base');
const model = require('./internal');
const config = require('../config');
const redisCtrl = require('../modules/redisCtrl');
const logger = require('../modules/logger');
const zkCtrl = require('../modules/zkCtrl');
const Mailer = require('../modules/mailer');
const { cipherAPIkey, decipherAPIkey, decrypt, encrypt, countryTimeDate } = require('../modules/utils');
const { USER_TEMP_SESSION_EXPIRE_TIME, ORDER_ALIVE } = require('../enum');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRcode = require('qrcode');
const { NotFindUserError,
    InvalidPasswordError,
    NeedUserEmailVerifyError,
    NeedGoogleOTPVerifyError,
    InvalidEmailCodeError,
    InvalidGoogleOTPTokenError,
    AuthTokenExpiredError,
    ExpireEmailCodeError,
    ExpireGoogleOTPTokenError,
    UserEmailAlreadyRegisteredError,
    UserNameAlreadyRegisteredError,
    ApiKeyAlreadyRegisterError,
    AlreadySignOutAccountError,
    NeedCheckApiKeyError,
    BlockedAccountError,
    NotInputExchangeApiKeyError,
    ApiKeyIsAliveError} = require('../modules/error');

const userAttributes = {
    id: {type: DataTypes.UUID, defaultValue:DataTypes.UUIDV4, primaryKey:true},
    userName: {type: DataTypes.STRING, allowNull: false},
    email: {type: DataTypes.STRING, allowNull: false, validate: {isEmail: true}},
    password: {type: DataTypes.STRING, allowNull: false},
    salt : {type: DataTypes.STRING},
    telegram: {type: DataTypes.STRING, allowNull: false, defaultValue: ''},
    grade: {type: DataTypes.STRING, allowNull: false, defaultValue: 'novis'},
    lastLogin: {type: DataTypes.DATE, defaultValue: DataTypes.NOW},
    affiliateFrom: {type: DataTypes.STRING, allowNull: false, defaultValue: 'traum'},
    country: {type: DataTypes.STRING, allowNull:false, defaultValue:''},
    timezone: {type: DataTypes.FLOAT, allowNull:false, defaultValue:0},
    timezoneString: {type: DataTypes.STRING, defaultValue:''},
    language: {type: DataTypes.STRING, allowNull:false, defaultValue:''},
    apiKeyMap: {type: DataTypes.JSON, allouNull:false, defaultValue:{}},
    status: {type: DataTypes.STRING(20), allowNull:false, defaultValue:'ALIVE'}, // ALIVE, SLEEP, BLOCK, SIGNOUT
    emailVerified: {type: DataTypes.BOOLEAN, defaultValue:false},
    otpSecretCode: {type: DataTypes.STRING},
    receiveMarketingInfo: {type: DataTypes.BOOLEAN, defaultValue:false}
};

class UserModel extends BaseModel {
    constructor(...args) {
        super(...args);
    }

    static initModel(sequelize) {
        UserModel.sequelize = sequelize;
        UserModel.init(userAttributes, {
            sequelize,
            modelName: 'User',
            indexes: [
                {
                    fields: ['userName'],
                    unique: true
                },
                {
                    fields: ['email'],
                    unique: true
                },
                {
                    fields: ['status'],
                },
                {
                    fields: ['country','language','status'],
                },
                {
                    fields: ['lastLogin']
                }
                ]});
        UserModel.beforeCreate(UserModel.setSaltAndPassword);
        UserModel.beforeUpdate(UserModel.setSaltAndPassword);
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

    static setSaltAndPassword(user){
        if(!user.salt) {
            user.salt = UserModel.generateSalt();
        }
        if (user.changed('password')){
            user.password = UserModel.encryptPassword(user.password, user.salt)
        }
    }
    //로그인 할때 필요
    validatePassword(enteredPassword) {
        return UserModel.encryptPassword(enteredPassword, this.salt) === this.password
    }


    static relationModel() {
        UserModel.hasMany(model.OrderPlan, {foreignKey:"userId"});
        UserModel.hasMany(model.Order, {as: 'orders', foreignKey:"userId"});
        UserModel.hasMany(model.Receipt, {as: 'receipts', foreignKey:"userId"});
        UserModel.hasMany(model.Strategy, {as: 'strategies', foreignKey:"userId"});
        UserModel.hasOne(model.PrivateSocket, {foreignKey:"userId"});
    }

    static async makeNew(userData){
        let userForm = {
            userName: userData.userName,
            email: userData.email,
            password: userData.password,
            country: userData.country,
            timezone: userData.timezone,
            timezoneString: userData.timezoneString,
            language: userData.language,
            lastLogin: userData.lastLogin,
            // apiKeyMap: '{}',
            receiveMarketingInfo: (userData.receiveMarketingInfo == true) ? true : false
        };
        const userModel = UserModel.build(userForm);
        await logger.info('USER','SIGNUP',{user: userModel, type: 'USER_STATUS'},'-');
        return userModel
    }

    convertInfoForm() {
        const subStringAt = 5;
        let apiKeyString = '';
        const convertApiKeyMap = {};
        for(const exchangeName in this.apiKeyMap) {
            const decipherKeys = decipherAPIkey(this.apiKeyMap[exchangeName].apiKey, this.apiKeyMap[exchangeName].secretKey, this.salt);
            apiKeyString = decipherKeys.apiKey.substring(0, subStringAt) + '***************************************';
            convertApiKeyMap[exchangeName] = {apiKey: apiKeyString, alive: this.apiKeyMap[exchangeName].alive}
            if(this.apiKeyMap[exchangeName].status) {
                convertApiKeyMap[exchangeName].status = this.apiKeyMap[exchangeName].status
            }
        }
        return {
            id: this.id, userName: this.userName, email: this.email, country: this.country, timezone: this.timezoneString,
            telegram: this.telegram, language: this.language, apiKeyMap: convertApiKeyMap,
            useOtp: this.otpSecretCode && this.otpSecretCode.length > 0 ? true : false,
            receiveMarketingInfo: this.receiveMarketingInfo
        }
    }

    static async signInByToken(token) {
        const userInfo = await redisCtrl.getUserSession(token);
        if(!userInfo) throw new AuthTokenExpiredError();
        const userModel = new model['User'](userInfo);
        return userModel;
    }

    static async signInByEmailAndPassword(email, password, otpCode) {
        const userModel = await UserModel.findOne({where:{email: email}});
        if(!userModel) throw new NotFindUserError();

        if(userModel.status == 'CHECKAPI') {
            throw new NeedCheckApiKeyError();
        }
        else if(userModel.status == 'SIGNOUT' || userModel.status == 'AUTOWITHDRAW') {
            throw new AlreadySignOutAccountError();
        }
        else if(userModel.status == 'BLOCK') {
            throw new BlockedAccountError();
        }

        if(!userModel.validatePassword(password)) throw new InvalidPasswordError();
        if(userModel.emailVerified == false) {
            throw new NeedUserEmailVerifyError();
        }
        await userModel.verifyGoogleOTP(otpCode);
        userModel.lastLogin = new Date();
        if(userModel.status == 'SLEEP_INTENDED' || userModel.status == 'SLEEP') {
            if(userModel.status == 'SLEEP') {
                await userModel.wakeUp();
            }
            userModel.status = 'ALIVE';
        }
        await userModel.save();
        await logger.info('USER','SIGNIN',{user: userModel, type: 'USER_ACCESS'},'-');
        return userModel;
    }

    async wakeUp() {
        const userPrivateSockets = await model['PrivateSocket'].findAll({where:{userId: this.id}});
        for(const userPrivateSocket of userPrivateSockets) {
            if(this.apiKeyMap[userPrivateSocket.exchange]) {
                userPrivateSocket.isAlive = true;
                await userPrivateSocket.save();
                await redisCtrl.pushQueue(`${userPrivateSocket.exchange}:socket:private:${userPrivateSocket.ip}`, `new||${JSON.stringify(this)}`);
            }
        }
        await logger.info('USER_STATUS', 'WAKEUP', this, '-');
    }

    async signOut(password, otpCode, token, reason, reasonDetail) {
        if(!this.validatePassword(password)) {
            throw new InvalidPasswordError();
        }
        await this.verifyGoogleOTP(otpCode);
        await this.disconnectPrivateSocketAndCancelOrder(undefined, true);
        await redisCtrl.delUserSession(token);
        this.status = 'SIGNOUT';
        this.apiKeyMap = {};
        await this.save();
        await logger.info('USER','SIGNOUT', {user: this, type: 'USER_STATUS', subAction: reason},{reasonDetail: reasonDetail});
        await Mailer.sendEmail(this.email, 'ACCOUNT_WITHDRAW_COMPLETED', this.language);
    }

    async disconnectPrivateSocketAndCancelOrder(exchange, destroyPrivateSocket=false, actualOnly = false) {
        const whereQuery = {"userId": this.id};
        if(exchange) {
            whereQuery["exchange"] = exchange;
        }
        const userPrivateSockets = await model['PrivateSocket'].findAll({where:whereQuery});
        let privateSocketIp;
        if(userPrivateSockets.length > 0) {
            for(const userPrivateSocket of userPrivateSockets) {
                privateSocketIp = userPrivateSocket.ip;
                await redisCtrl.pushQueue(`${userPrivateSocket.exchange}:socket:private:${privateSocketIp}`, `delete||${JSON.stringify(this)}`);
                await redisCtrl.deleteUserActualBalance(this.id, userPrivateSocket.exchange);
                if(destroyPrivateSocket) {
                    await userPrivateSocket.destroy();
                }
                else {
                    userPrivateSocket.isAlive = false;
                    await userPrivateSocket.save();
                }
            }
        }

        const orderPlanWhereQuery = {
            userId: this.id,
            active:ORDER_ALIVE.ACTIVE
        }
        if(actualOnly) orderPlanWhereQuery.isVirtual = false;
        const orderPlans = await model['OrderPlan'].findAll({
            where: orderPlanWhereQuery,
            include:[{
                model: model['Order'],
                as: 'subOrders',
            }]});
        const promises = [];
        for(const orderPlan of orderPlans) {
            promises.push(orderPlan.cancel());
        }
        await Promise.all(promises)
    }

    static async validateEmail(email) {
        const userModel = await UserModel.findOne({where:{email:email}});
        if(userModel) {
            if(userModel.status === 'SIGNOUT') {
                throw new AlreadySignOutAccountError();
            }
            throw new UserEmailAlreadyRegisteredError();
        }
    }

    static async validateUserName(userName) {
        const userModel = await UserModel.findOne({where:{userName:userName}});
        if(userModel) throw new UserNameAlreadyRegisteredError();
    }

    static async updatePassword(token, password) {
        const userId = await redisCtrl.getUserSession(token, 'update_password');
        const user = await model['User'].findByPk(userId);
        if(!user) {
            throw new AuthTokenExpiredError()
        }
        user.password = password;
        await user.save();
        await redisCtrl.delUserSession(token, 'update_password');
        await logger.info('USER','MODIFY',{user: user, type: 'USER_INFORMATION'},'updatedPassword');
        await Mailer.sendEmail(user.email, 'PASSWORD_UPDATE_COMPLETED', user.language);

    }

    async updateApiKey(exchangeName, apiKey, secretKey, passphrase=undefined) {
        const encryptedApiKey = encrypt(apiKey, config.aes.apiKeyEnc);
        const alreadyRegistSocket = await model['PrivateSocket'].findOne({where: {"apiKey": encryptedApiKey}});
        if(alreadyRegistSocket) {
            if(alreadyRegistSocket.userId != this.id) {
                throw new ApiKeyAlreadyRegisterError();
            }
        }
        const cipherKeyInfo = cipherAPIkey(apiKey, secretKey, this.salt);
        const newApiKeyMap = Object.assign({}, this.apiKeyMap);
        newApiKeyMap[exchangeName] = {
            apiKey: cipherKeyInfo.apiKey,
            secretKey: cipherKeyInfo.secretKey,
            alive: true
        };
        if(passphrase) {
            newApiKeyMap[exchangeName].passphrase = encrypt(passphrase, this.salt)
        }
        this.apiKeyMap = newApiKeyMap;
        await this.save();
        await logger.info('USER','NEW',{user: this, type: 'USER_INFORMATION'},`${exchangeName.toUpperCase()}: updatedAPIKEY`);
        const userPrivateSockets = await model['PrivateSocket'].findAll({where:{"exchange":exchangeName, "userId": this.id}});
        let userPrivateSocket, privateSocketIp;
        if(userPrivateSockets.length > 0) {
            userPrivateSocket = userPrivateSockets[0];
            privateSocketIp = userPrivateSocket.ip;
            await redisCtrl.pushQueue(`${exchangeName}:socket:private:${privateSocketIp}`, `delete||${JSON.stringify(this)}`);
            userPrivateSocket.isAlive = true;
            userPrivateSocket.apiKey = encryptedApiKey;
        }
        else {
            const socketServerList = await zkCtrl.getPrivateSocketServerList(exchangeName);
            const orderedServerList = await model['PrivateSocket'].findAllServerList(exchangeName, socketServerList);
            privateSocketIp = orderedServerList[0].ip;
            userPrivateSocket = new model['PrivateSocket']({userId:this.id, ip:privateSocketIp, apiKey: encryptedApiKey, exchange: exchangeName});
        }
        await userPrivateSocket.save();
        await redisCtrl.pushQueue(`${exchangeName}:socket:private:${privateSocketIp}`, `new||${JSON.stringify(this)}`);
    }

    async initializeApiKeyAndRecoveryStatus(exchange) {
        if(this.status == 'SIGNOUT') {
            throw new AlreadySignOutAccountError();
        }
        else if(this.status == 'BLOCK') {
            throw new BlockedAccountError();
        }
        if(!this.apiKeyMap[exchange]) {
            throw new NotInputExchangeApiKeyError();
        }
        if(this.apiKeyMap[exchange].alive == true) {
            throw new ApiKeyIsAliveError();
        }
        const decryptApiKey = decrypt(this.apiKeyMap[exchange].apiKey, this.salt);
        const encryptedApiKey = encrypt(decryptApiKey, config.aes.apiKeyEnc);
        const alreadyRegistSocket = await model['PrivateSocket'].findOne({where: {"apiKey": encryptedApiKey}});
        if(alreadyRegistSocket) {
            await alreadyRegistSocket.destroy();
        }
        const newApiKeyMap = Object.assign({}, this.apiKeyMap);
        delete newApiKeyMap[exchange];
        this.apiKeyMap = newApiKeyMap;
        this.changed('apiKeyMap', true);
        await this.save();
    }

    static async sendAuthenticationMail (email, mailType) {
        const userModel = await UserModel.findOne({where:{email: email}});
        if(!userModel) {
            throw new NotFindUserError();
        }
        if(userModel.status == 'SIGNOUT') {
            throw new AlreadySignOutAccountError();
        }
        else if(userModel.status == 'BLOCK') {
            throw new BlockedAccountError();
        }

        const randomCode = Math.floor(Math.random() * (999999-100000) + 100000);
        if(mailType === 'PASSWORD_AUTHENTICATION') {
            await Mailer.sendEmail(email, 'PASSWORD_AUTHENTICATION_CODE', userModel.language, {code:randomCode});
        }
        else if(mailType === 'REGISTER_AUTHENTICATION') {
            await Mailer.sendEmail(email, 'REGISTER_AUTHENTICATION_CODE', userModel.language, {code:randomCode});
        }
        await redisCtrl.setUserSession(userModel.email, randomCode, USER_TEMP_SESSION_EXPIRE_TIME, mailType);
        return;
    };


    async verifyAuthenticationMail (code, mailType) {
        const emailCode = await redisCtrl.getUserSession(this.email, mailType);
        if(!emailCode) throw new ExpireEmailCodeError();
        if (emailCode != code) throw new InvalidEmailCodeError();
        await redisCtrl.delUserSession(this.email, 'authentication_mail');
        return;
    };


    async generateGoogleOTPData () {
        const secret = await authenticator.generateSecret();
        const otpAuth = await authenticator.keyuri(this.email, config.serviceName, secret);
        const imageUrl = await QRcode.toDataURL(otpAuth);
        await redisCtrl.setUserSession(this.email, secret, USER_TEMP_SESSION_EXPIRE_TIME*2, 'googleOTP');
        return {
            imageData: imageUrl,
            secretCode: secret
        };
    };

    async activateGoogleOTP (otpCode) {
        const userOtpSecretCode = await redisCtrl.getUserSession(this.email, 'googleOTP');
        if(!userOtpSecretCode) {
            throw new ExpireGoogleOTPTokenError();
        }
        const verify = await authenticator.verify({token: `${otpCode}`, secret: userOtpSecretCode});
        if (verify === false){
            throw new InvalidGoogleOTPTokenError();
        }
        else {
            this.otpSecretCode = userOtpSecretCode;
            await this.save();
            await logger.info('USER','NEW',{user: this, type: 'USER_INFORMATION'},'updatedOTP');
            await Mailer.sendEmail(this.email, 'GOOGLEOTP_REGISTER_COMPLETED', this.language)
        }
        return verify;
    };

    async deactivateGoogleOTP (otpCode) {
        await this.verifyGoogleOTP(otpCode);
        this.otpSecretCode = null;
        await this.save();
        await logger.info('USER','DELETE',{user: this, type: 'USER_INFORMATION'},'deletedOTP');
        return;
    };

    async verifyGoogleOTP(otpCode) {
        if(this.otpSecretCode && this.otpSecretCode.length > 0) {
            if(!otpCode) {
                throw new NeedGoogleOTPVerifyError();
            }
            const verify = await authenticator.verify({token: `${otpCode}`, secret: this.otpSecretCode});
            if(verify === false) {
                throw new InvalidGoogleOTPTokenError();
            }
        }
        return;
    };

    async getOrderPlanHistoryToMap(isVirtual=false) {
        const orderGroups = await model['OrderPlan'].findAll( {
            where: {userId: this.id, isVirtual: isVirtual},
            group: ['planType', 'symbol'],
            attributes: ['planType', 'symbol', [model.Sequelize.fn('COUNT', 'symbol'), 'count']],
            raw: true
        });
        const planTypeMap = {};
        const symbolMap = {};
        for(const orderCount of orderGroups) {
            if(!planTypeMap[orderCount['planType']]) {
                planTypeMap[orderCount['planType']] = {};
            }
            planTypeMap[orderCount['planType']][orderCount['symbol']] = parseInt(orderCount['count']);
            if(!symbolMap[orderCount['symbol']]) {
                symbolMap[orderCount['symbol']] = 0
            }
            symbolMap[orderCount['symbol']] += parseInt(orderCount['count']);
        }
        return [planTypeMap, symbolMap];
    }

    async modifyUserInformation(userName, country, timezone, timezoneString) {
        if(this.userName != userName) {
            const anotherUser = await model['User'].findOne({where: {userName: userName}});
            if(anotherUser) {
                throw new UserNameAlreadyRegisteredError();
            }
        }

        const logContent = {
            route: 'updatedMyInformation',
            data: {
                userName: `${this.userName} -> ${userName}`,
                country: `${this.country} -> ${country}`,
                timezone: `${this.timezone} -> ${timezone}`,
                timezoneString: `${this.timezoneString} -> ${timezoneString}`,
            }
        };
        this.userName = userName;
        this.country = country;
        this.timezone = timezone;
        this.timezoneString = timezoneString;
        await this.save();
        await logger.info('USER','MODIFY',{user: this, type: 'USER_INFORMATION'}, logContent);

    }

    async modifyNotificationInformation(language, receiveMarketingInfo, telegram) {
        const logContent = {
            route: 'updatedNotificationInformation',
            data: {
                language: `${this.language} -> ${language}`,
                receiveMarketingInfo: `${this.receiveMarketingInfo ? 'True' : 'False'} -> ${receiveMarketingInfo ? 'True' : 'False'}`,
                telegram: `${this.telegram} -> ${telegram}`,
            }
        };
        this.language = language;
        this.receiveMarketingInfo = receiveMarketingInfo;
        this.telegram = telegram ? telegram : '';
        await this.save();
        await logger.info('USER','MODIFY',{user: this, type: 'USER_INFORMATION'}, logContent);
    }

    static async checkIntendedDormantUser() {
        const checkDate = new Date(Date.now() - (1000*60*60*24*90));
        const intendedSleepUsers = await model['User'].findAll({
            where: {
                lastLogin: {[model.Sequelize.Op.lte]: checkDate},
                status: {[model.Sequelize.Op.notIn] : ['SIGNOUT', 'BLOCK', 'SLEEP_INTENDED', 'SLEEP', 'AUTOWITHDRAW']},
                emailVerified: true
            }
        });
        if(intendedSleepUsers.length > 0) {
            await Promise.all(intendedSleepUsers.map(async (user) => {
                user.status = 'SLEEP_INTENDED';
                await user.save();
                const sleepDate = new Date(Date.now() + (1000*60*60*24*30));
                sleepDate.setHours(0);
                sleepDate.setMinutes(0);
                sleepDate.setSeconds(0);
                await Mailer.sendEmail(user.email, 'ACCOUNT_DORMANT_NOTICE', user.language,
                    {timestamp: countryTimeDate(sleepDate.getTime(), user.timezone)});
            }));
        }
    }

    static async checkDormantUser() {
        const checkDate = new Date(Date.now() - (1000*60*60*24*120));
        const dormantUsers = await model['User'].findAll({
            where: {
                lastLogin: {[model.Sequelize.Op.lte]: checkDate},
                status: {[model.Sequelize.Op.notIn] : ['SIGNOUT', 'BLOCK', 'SLEEP', 'AUTOWITHDRAW']},
                emailVerified: true
            }
        });
        for(const user of dormantUsers) {
            await user.disconnectPrivateSocketAndCancelOrder();
            user.status = 'SLEEP';
            await user.save();
            const nowDate = new Date();
            nowDate.setHours(0);
            nowDate.setMinutes(0);
            nowDate.setSeconds(0);
            await logger.info('USER_STATUS', 'SLEEP', user, '-');
            return await Mailer.sendEmail(user.email, 'ACCOUNT_DORMANT_COMPLETED', user.language, {timestamp: countryTimeDate(nowDate.getTime(), user.timezone)});
        }
    }

    static async checkAutoWithdrawUser() {
        const checkDate = new Date(Date.now() - (1000*60*60*24*365*5));
        const autoWithdrawUsers = await model['User'].findAll({
            where: {
                lastLogin: {[model.Sequelize.Op.lte]: checkDate},
                status: {[model.Sequelize.Op.notIn] : ['SIGNOUT', 'BLOCK']},
                emailVerified: true
            }
        });
        for(const user of autoWithdrawUsers) {
            await user.disconnectPrivateSocketAndCancelOrder(undefined, true);
            user.status = 'AUTOWITHDRAW';
            user.apiKeyMap = {};
            await user.save();
            const nowDate = new Date();
            nowDate.setHours(0);
            nowDate.setMinutes(0);
            nowDate.setSeconds(0);
            await logger.info('USER_STATUS', 'AUTHWITHDRAW', user, '-');
            return await Mailer.sendEmail(user.email, 'ACCOUNT_AUTOWITHDRAW_COMPLETED', user.language, {timestamp: countryTimeDate(nowDate.getTime(), user.timezone)});
        }
    }

    static async setUserAllStatus(){
        const result = {
            ALIVE: 0,
            SLEEP: 0,
            SIGNOUT: 0,
        };

        const userStatusDatas = await model['User'].findAll({
            attributes: [
                'status',
                [model.sequelize.fn('count', model.sequelize.col('status')),'count'],
            ],
            where:{
                status: {[Op.in]: ['ALIVE','SLEEP_INTENDED','SIGNOUT', 'SLEEP']},
            },
            group:['status']
        });

        if(userStatusDatas.length === 0) return await redisCtrl.setAdminDashBoardData('userAllStatus', result);

        for(const userStatusData of userStatusDatas){
            if(userStatusData.status === 'SLEEP_INTENDED'){
                result['ALIVE'] += parseInt(userStatusData['dataValues'].count);
            }else{
                result[userStatusData.status] = parseInt(userStatusData['dataValues'].count);
            }
        }
        await redisCtrl.setAdminDashBoardData('userAllStatus', result);
    }

    static async setUserSignUpCountryRankStatus(){
        const queryString = `SELECT a.country, a.count, a.rank
                                FROM
                                (
                                    SELECT  "country", COUNT(1) AS count, ROW_NUMBER() OVER (ORDER BY count(1) DESC) AS rank
                                    FROM "Users"
                                    GROUP BY "country"
                                ) a
                                WHERE a.rank <= 5`;
        const userDatas = await model.sequelize.query(queryString);
        await redisCtrl.setAdminDashBoardData('userSignUpCountryRankStatus', userDatas[0]);
    }
}

module.exports = UserModel;