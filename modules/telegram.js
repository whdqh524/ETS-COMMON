const model = require('../model/internal');
const logger = require('../modules/logger');
const { TelegramServerError, TelegramServerRequestTimeOutError } = require('../modules/error');
const redisCtrl = require('../modules/redisCtrl');
const { retryWrapper } = require('../modules/utils');
const uuidv4 = require('uuid').v4;
require('../modules/utils');
let instance = null;


class TelegramManger {
    constructor() {
        this.telegramMap = {};
    }

    async makeTelegramMap(){
        const telegramModels = await model['Telegram'].findAll();
        for(const telegramModel of telegramModels){
            if(this.telegramMap[telegramModel.code]){
                this.telegramMap[telegramModel.code][telegramModel.language] = telegramModel.content;
            }else{
                this.telegramMap[telegramModel.code] = {[telegramModel.language]: telegramModel.content}
            }
        }
    }


    async sendTelegramMessage(user, code, content){
        try {
            if(!this.telegramMap[code]) throw new TelegramServerError(`Telegram code not registered. - [${code}]`);
            const message = this.telegramMap[code][user.language];
            if(!message) return;
            const messageContent = message.format(content);
            const telegramOption = {
                eventType: 'sendMessage',
                serviceName: 'CoinButler_Bot',
                telegramId: user.telegram,
                uuid: uuidv4(),
                message: messageContent,
            };
            await retryWrapper(redisCtrl.pushTelegramQueue, JSON.stringify(telegramOption));
            const response = await retryWrapper(redisCtrl.listenTelegramResponse, telegramOption.uuid, 5);
            if(!response) throw new TelegramServerRequestTimeOutError();
            const responseValue = JSON.parse(response);
            if(responseValue.status !== 'success') throw new TelegramServerError(responseValue);
        }catch (e) {
            if(!e.lastError.stack) e.lastError.stack = e.stack;
            await logger.error(e,{},{userId: user.id, userName: user.userName});
            await this.deleteTelegramUserInfo(user, e)
        }
    }

    async deleteTelegramUserInfo(user, error){
        if(!(error instanceof TelegramServerError)){
            return;
        }
        if(error.lastError && error.lastError.errorCode){
            switch (error.lastError.errorCode) {
                case 'TELEGRAM_BLOCKED_USER':
                    user.telegram = '';
                    await user.save();
                    await logger.info('USER','DELETE',{user:user, type: 'USER_INFORMATION'},'deletedTelegram');
                    break;
                case 'TELEGRAM_CHAT_NOT_FOUND':
                    user.telegram = '';
                    await user.save();
                    await logger.info('USER','DELETE',{user:user, type: 'USER_INFORMATION'},'deletedTelegram');
                    break;
                case 'TELEGRAM_CHAT_EMPTY_VALUE':
                    user.telegram = '';
                    await user.save();
                    await logger.info('USER','DELETE',{user:user, type: 'USER_INFORMATION'},'deletedTelegram');
                    break;
            }
        }
    }


    static getInstance(){
        if(instance === null){
            instance = new TelegramManger();
        }
        return instance
    }

}

module.exports = TelegramManger.getInstance();

