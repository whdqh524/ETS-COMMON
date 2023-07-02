'use strict';

const { Model } = require('sequelize');
const {retryWrapper} = require('../modules/utils');
const {TelegramDataFormError} = require('../modules/error');
const logger = require('../modules/logger');
const config = require('../config');
const axios = require('axios');

const uuidv4 = require('uuid').v4;
const redisCtrl = require('../modules/redisCtrl');
const model = require('../model');
const telegramManager = require('../modules/telegram');


class BaseModel extends Model {
    constructor(...args) {
        super(...args);
    }

    static initModel(attributes, options) {
        Model.init(attributes, options)
    }

    async sendTelegramMessage (action) {
        try {
            if(!(this instanceof model['Order'] || this instanceof model['OrderPlan'])) return ;
            let user = this.user;
            if(!user) {
                user = await model['User'].findByPk(this.userId);
                this['user'] = user;
            }
            if(!user.telegram) return;
            const telegramForm =  await this.convertTelegramForm(action);
            if(telegramForm) {
                const [code, content] = telegramForm;
                await telegramManager.sendTelegramMessage(user, code, content);
            }
        }catch (e) {
            await logger.error(e, {}, {userId: this.user.id, userName: this.user.userName});
        }
    }
}

exports.BaseModel = BaseModel;


