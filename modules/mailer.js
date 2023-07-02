'use strict';

const config = require('../config');
const model = require('../model');
const redisCtrl = require('./redisCtrl');
require('../modules/utils');
let instance = null;

class Mailer {
    constructor() {
        this.mailMap = {};
    }

    async makeMailMap(){
        const emailModels = await model['Email'].findAll();
        for(const emailModel of emailModels){
            if(!this.mailMap[emailModel.code]) {
                this.mailMap[emailModel.code] = {}
            }
            this.mailMap[emailModel.code][emailModel.language] = {title: emailModel.title, content: emailModel.content};
        }
    }

    async sendEmail(receiver, code, language, dataValues){
        if(!this.mailMap[code]) return Error('Email code not registered.');
        if(!language || language.length == 0) {
            language = 'ko';
        }
        const emailInfo = this.mailMap[code][language];
        if(!emailInfo) return;
        let messageContent = emailInfo.content;
        if(dataValues) {
            for(const key in dataValues) {
                const keyStr = `{${key}}`;
                messageContent = messageContent.split(keyStr).join(dataValues[key]);
            }
            // messageContent = emailInfo.content.htmlFormat(dataValues);
        }

        const mailOptions =  {
            from: `"CoinButler" <${config.adminEmail}>`,
            to :  receiver,
            subject :  emailInfo.title,
            generateTextFromHTML : true,
            html : messageContent
        };

        return await redisCtrl.pushMailerQueue(JSON.stringify(mailOptions));
    }


    static getInstance(){
        if(instance === null){
            instance = new Mailer();
        }
        return instance
    }
}

module.exports = Mailer.getInstance();
