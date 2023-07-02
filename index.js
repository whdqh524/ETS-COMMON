'use strict';

module.exports = {
    modules: require('./modules'),
    config: require('./config'),
    enum: require('./enum'),
    calc: require('./modules/calc'),
    error: require('./modules/error'),
    logger: require('./modules/logger'),
    queue: require('./modules/queue'),
    redisCtrl: require('./modules/redisCtrl'),
    timeFunc: require('./modules/timeFunc'),
    utils: require('./modules/utils'),
    zkCtrl: require('./modules/zkCtrl'),
    telegramManager: require('./modules/telegram'),
    mailer: require('./modules/mailer')
};