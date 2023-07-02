"use strict";

const winston = require( 'winston' );// Or read from a configuration
const axios = require('axios');


const processName = process.env.NODE_NAME || "ETS-Server";
const env  = process.env.NODE_ENV || "development";
const config = require('../config');
const { EtsErrorWithoutLogging, SlackRequestError } = require('./error');
const model = require('../model');


let myConsoleFormat = winston.format.printf(({level, message, timestamp, ...rest}) => {
    try {
        let jsonResult = JSON.stringify(rest);
        let resultString = (jsonResult.length > 1000) ? jsonResult.slice(0,1000) + '...' : jsonResult;
        return `[${level}] ${timestamp} : ${message} - ${resultString}`
    }
    catch(e) {
        console.log(e);
    }
});


class Logger {
    constructor () {
        this.actionLogger = winston.createLogger({
            transports: [
                new winston.transports.Console({
                    level: 'info', // Only write logs of warn level or higher
                    format: winston.format.combine(
                        winston.format.colorize({all: true}), //색바꿔주는거
                        winston.format.timestamp(), //시간 찍어주는거
                        myConsoleFormat //메세지 form
                    )
                }),
            ]
        });

        this.errorLogger = winston.createLogger({
            transports: [
                new winston.transports.Console({
                    level: 'warn', // Only write logs of warn level or higher
                    format: winston.format.combine(
                        winston.format.colorize({all: true}),
                        winston.format.timestamp(),
                        myConsoleFormat
                    )
                }),
            ]
        });
    }

    async sendSlackBot(msg, option, serverType = undefined) {
        try {
            if(!serverType) serverType = process.env.NODE_ENV ? process.env.NODE_ENV : 'dev';
            const result = await axios.post(config.slack.uri,{
                username: processName,
                blocks: [
                    {
                        type: "header",
                        text: {
                            type: "plain_text",
                            text: `${msg}`,
                            emoji: true
                        }
                    },
                    {
                        type: "divider"
                    },
                ],
                attachments: [{text: JSON.stringify(option),}],
                channel: processName !== 'AdminServer' ? `#coinbutler-spot-${serverType}` : `#coinbutler-spot-admin-${serverType}`,
                icon_emoji: 'slack'
            },{headers: { authorization: `Bearer ${config.slack.token}` },});
            if(result.data.ok !== true) throw new SlackRequestError(result.data.error);
        }catch (e) {
            this.errorLogger.error(e.constructor.name, e);
        }
    }
    async sendInternalErrorSlackBot(errorData, errorSlackData, serverType = undefined){
        try {

            const slackContentkeyList = ['orderPlanId', 'orderId', 'side', 'userId', 'userName'];
            let slackText = '';

            for(const key of slackContentkeyList){
                slackText += `*${key}*: ${errorSlackData[key] ? errorSlackData[key] : '-'}\n`
            }

            if(!serverType) serverType = process.env.NODE_ENV ? process.env.NODE_ENV : 'dev';
            const result = await axios.post(config.slack.uri,{
                username: processName,
                blocks: [
                    {
                        type: "header",
                        text: {
                            type: "plain_text",
                            text: `${errorData.errorName}`,
                            emoji: true
                        }
                    },
                    {
                        type: "divider"
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: slackText
                        }
                    },
                    {
                        type: "divider"
                    }
                ],
                attachments: [
                    {
                        text:JSON.stringify(errorData.stack)
                    }
                ],
                channel: processName !== 'AdminServer' ? `#coinbutler-spot-${serverType}` : `#coinbutler-spot-admin-${serverType}`,
                icon_emoji: 'slack'
            },{headers: { authorization: `Bearer ${config.slack.token}` },});
            if(result.data.ok !== true) throw new SlackRequestError(result.data.error);
        }catch (e) {
            this.errorLogger.error(e.constructor.name, e);
        }
    }

    errorConsole(err){
        try {
            const errorName = (err instanceof Error) ? err.constructor.name:
                err['errorName'] ? err['errorName'] : 'UnknownError';
            this.errorLogger.error(errorName, err);
        }catch (e) {
            this.errorLogger.error(e.constructor.name, e);
        }
    }


    infoConsole(msg,options) {
        try {
            let data = options;
            if(options instanceof model.Sequelize.Model) {
                data = options['dataValues'];
            }
            this.actionLogger.info(msg, data);
        }
        catch (e) {
            this.errorLogger.error(e.constructor.name, e);
        }
    };

    async error (errorData, content = {}, slackContent = {}, type = 'SYSTEM') {
        try {
            if(['product', 'staging', 'development', 'testserver'].includes(env)) {
                let errorForm = {};
                let withLogging = true;
                if(errorData instanceof Error) {
                    if(errorData instanceof EtsErrorWithoutLogging) {
                        withLogging = false;
                    }
                    errorForm['serverName'] = processName;
                    errorForm['errorName'] =  errorData.constructor.name;
                    errorForm['errorMessage'] = (errorData.desc) ? errorData.desc : errorData.message ? errorData.message : errorData.lastError ? errorData.lastError.message : '-';
                    errorForm['stack'] = (errorData.lastError) ? errorData.lastError.stack.split("\n") : (errorData.stack) ? errorData.stack.split("\n") : '-';
                    errorForm['content'] = content ? content : '-';
                    errorForm['createdAt'] = new Date();
                    errorForm['errorType'] = type;
                }
                else {
                    errorForm = errorData;
                    if(!errorForm['createdAt']) {
                        errorForm['createdAt'] = new Date();
                    }
                }
                if(withLogging) {
                    await model['errorLog'].makeNew(errorForm);
                    (slackContent.userId) ? await this.sendInternalErrorSlackBot(errorForm, slackContent):
                        await this.sendSlackBot(errorForm['errorName'], errorForm['stack']);
                }
            }
            const errorName = (errorData instanceof Error) ? errorData.constructor.name:
                errorData['errorName'] ? errorData['errorName'] : 'UnknownError';
            this.errorLogger.error(errorName, errorData);
        }catch (e) {
            this.errorLogger.error(e.constructor.name, e);
        }
    };

    async info(loggerType, action, infoData, content) {
        try{
            if(['ORDER', 'USER', 'ADMIN'].includes(loggerType)) {
                await this.logToDatabase(loggerType, action, infoData, content);
            }
            let logTitle = `[${loggerType} : ${action}]`;
            let data = infoData;
            if(infoData instanceof model.Sequelize.Model) {
                logTitle += ` - [${infoData.constructor.name} : ${infoData.id}]`;
                data = infoData['dataValues'];
            }
            this.actionLogger.info(logTitle, data);
        }catch (e) {
            this.errorLogger.error(e.constructor.name, e);
        }
    }

    async logToDatabase(loggerType, action, infoData, content){
        switch (loggerType) {
            case 'ORDER' :
                Array.isArray(infoData) ? await model['orderLog'].makeNewMany(action, infoData, content) : await model['orderLog'].makeNew(action, infoData, content);
                break;
            case 'ADMIN' :
                await model['adminLog'].makeNew(action, infoData, content);
                break;
            case 'USER' :
                await model['userLog'].makeNew(action, infoData, content);
                break;
            case 'STRATEGY':
                await model['strategyIndicatorLog'].makeNew(infoData);
                break;
        }
    }

}

const logger = new Logger();
module.exports = logger;