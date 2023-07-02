'use strict';

const env = process.env.NODE_ENV || "development";
const envFile = (env === 'product') ? '.env' : (env === 'staging') ? '.env.staging' : (env === 'testserver') ? '.env.test' : '.env.dev';
const path = require('path');
const envPath = `${path.resolve(envFile)}`;
require('dotenv').config({path:envPath});

const configMap = {
    serviceName: process.env.SERVICE_NAME,
    postgreSql: {
        database: process.env.POSTGRE_DATABASE,
        userName: process.env.POSTGRE_USERNAME,
        password: process.env.POSTGRE_PASSWORD,
        options: {
            dialect: process.env.POSTGRE_OPTIONS_DIALECT,
            host: process.env.POSTGRE_OPTIONS_HOST,
            pool: {
                max: parseInt(process.env.POSTGRE_OPTIONS_POOL_MAX),
                min: parseInt(process.env.POSTGRE_OPTIONS_POOL_MIN),
                idle: parseInt(process.env.POSTGRE_OPTIONS_POOL_IDLE)
            },
            logging: (process.env.POSTGRE_OPTIONS_LOGGING == 1) ? console.log : false
        }
    },
    mongoDBOhlc: {
        uri: process.env.MONGODB_OHLC_URI,
        options: {
            poolSize: process.env.MONGODB_OPTIONS_POOLSIZE,
            useUnifiedTopology: process.env.MONGODB_OPTIONS_USE_UNIFIED_TO_POLOGY,
            useNewUrlParser: process.env.MONGODB_OPTIONS_USE_NEW_URL_PARSER,
            useCreateIndex: process.env.MONGODB_OPTIONS_USE_CREATE_INDEX
        }
    },
    redis: {
        base_info: {
            host: process.env.REDIS_BASE_HOST,
            port: process.env.REDIS_BASE_PORT,
            db: process.env.REDIS_BASE_DB
        },
        proxy_info: {
            host: process.env.REDIS_PROXY_HOST,
            port: process.env.REDIS_PROXY_PORT,
            db: process.env.REDIS_PROXY_DB
        }
    },
    telegram: {
        checkUri: process.env.TELEGRAM_CHECK_URI,
        sendUri: process.env.TELEGRAM_SEND_URI
    },
    slack: {
        token: process.env.SLACK_TOKEN,
        uri: process.env.SLACK_URI
    },
    aes: {
        apiKeyEnc: process.env.API_KEY_ENCRYPT,
        secretKeyEnc: process.env.SECRET_KEY_ENCRYPT
    },
    ssoServer: {
        uri: process.env.SSO_SERVER_URI
    },
    zookeeper: {
        uri: process.env.ZOOKEEPER_URI,
        port: process.env.ZOOKEEPER_PORT
    },
    adminEmail: process.env.MAILLER_ACCOUNT,
    adminPassword: process.env.MAILLER_PASSWORD,
    exchangeList: (process.env.EXCHANGE_LIST.length > 0 && process.env.EXCHANGE_LIST.startsWith('[')) ?
    JSON.parse(process.env.EXCHANGE_LIST) : process.env.EXCHANGE_LIST,
};

if(!(env === 'product' || env === 'staging')) {
    if(process.env.REDIS_BASE_PASSWORD) {
        configMap.redis.base_info.password = process.env.REDIS_BASE_PASSWORD;
    }
    if(process.env.REDIS_PROXY_PASSWORD) {
        configMap.redis.proxy_info.password = process.env.REDIS_PROXY_PASSWORD;
    }
}
if(env === 'development') {
    if(process.env.MONGODB_USER) {
        configMap.mongoDBOhlc.user = process.env.MONGODB_USER;
    }
}

module.exports = configMap;