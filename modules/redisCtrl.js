"use strict";

const processName  = process.env.NODE_NAME || "ETS-Server";
const config = require('../config');
const {roundTicker} = require('./utils');
const {USER_TEMP_SESSION_EXPIRE_TIME, PACKET_SESSION_EXPIRE_TIME, ADMIN_SESSION_EXPIRE_TIME, CONVERT_INTEGER_VALUE} = require('../enum');
const redis = require('redis');
const asyncRedis = require('async-redis');
const excClient = asyncRedis.decorate(redis.createClient(config.redis.base_info));
const apiProxyClient = asyncRedis.decorate(redis.createClient(config.redis.proxy_info));
let listenClient;

const { retryWrapper } = require('./utils');
const { RedisError } = require('./error');

if(processName != "Api-Server") {
    listenClient = asyncRedis.decorate(redis.createClient(config.redis.base_info));
}

excClient.on('connect', (ready) => {
    console.log("Connected Redis - Execute Client");
});
excClient.on('error', (err) => {
    throw new RedisError(err);
});

if(listenClient) {
    listenClient.on('connect', (ready) => {
        console.log("Connected Redis - Listen Client");
    });
    listenClient.on('error', (err) => {
        throw new RedisError(err);
    });
}

const getAllMarketData = async(exchange) => {
    return await excClient.hgetall(`${exchange}:marketData`);
};
exports.getAllMarketData = getAllMarketData;

/**
 * async function getMarketData
 * 거래소 정보가 저장되어있는 'ets_tickSize' 테이블에서 특정 거래소에 대한 정보를 가져오는 함수
 * @param key - 거래소 key ( String ) : ex) 'binance'
 * @returns {Promise<any>}
 */
const getMarketData = async (exchange, symbol) => {
    let exchangeData = await excClient.hget(`${exchange}:marketData`, symbol);
    return JSON.parse(exchangeData);
};
exports.getMarketData = getMarketData;

const setMarketData = async (exchange, symbol, data) => {
    return await excClient.hset(`${exchange}:marketData`, symbol, data);
};
exports.setMarketData = async(...args) => retryWrapper(setMarketData, ...args);

const setAllMarketData = async (exchange, marketInfoList) => {
    const queries = [];
    for(const marketInfo of marketInfoList) {
        queries.push(marketInfo.symbol);
        queries.push(JSON.stringify(marketInfo));
    }
    return await excClient.hmset(`${exchange}:marketData`, queries);
};
exports.setAllMarketData = async(...args) => retryWrapper(setAllMarketData, ...args);

const deleteMarketData = async(exchange, symbol) => {
    return await excClient.hdel(`${exchange}:marketData`, symbol);
};
exports.deleteMarketData = async(...args) => retryWrapper(deleteMarketData, ...args);

const getMarketListKeys = async(exchange) =>{
    return await excClient.smembers(`${exchange}:marketList`);
};
exports.getMarketListKeys = getMarketListKeys;

const setMarketListKey = async(exchange, key) => {
    return await excClient.sadd(`${exchange}:marketList`, key);
};
exports.setMarketListKey = async(...args) => retryWrapper(setMarketListKey, ...args);

const deleteMarketListKey = async(exchange, key) => {
    return await excClient.srem(`${exchange}:marketList`, key);
};
exports.deleteMarketListKey = async(...args) => retryWrapper(deleteMarketListKey, ...args);

/**
 * async function getOrderDetail
 * 'order_detail'에서 특정 주문에 대한 정보를 가져오는 함수
 * @param key - 주문 key ( String ) : ex) 'user05:124126151515151'
 * @returns {Promise<any>}
 */
const getOrderDetail = async (exchangeName, key) => {
    let orderDetailString =  await excClient.hget(`${exchangeName}:watcher:orderDetail`, key);
    return JSON.parse(orderDetailString);
};
exports.getOrderDetail = async(...args) => retryWrapper(getOrderDetail, ...args);

/**
 * async functiion setOrderDetail
 * 'order_detail'에 변경된 주문 혹은 새로운 주문에 대한 정보를 저장하는 함수
 * @param data - 주문 data ( Map )
 * @returns {Promise<any>}
 */
const setOrderDetail = async (order) => {
    return await excClient.hset(`${order.exchange}:watcher:orderDetail`, order.id, JSON.stringify(order));
};
exports.setOrderDetail = async (...args) => retryWrapper(setOrderDetail, ...args);

/**
 * async function deleteOrderDetail
 * 주문이 매도 완료 혹은 캔슬된 경우 레디스에서 주문 정보를 삭제하는 함수
 * @param data - 주문 data ( Map )
 * @returns {Promise<any>}
 */
const deleteOrderDetail = async (exchangeName, key) => {
    return await excClient.hdel(`${exchangeName}:watcher:orderDetail`, key);
};
exports.deleteOrderDetail = async (...args) => retryWrapper(deleteOrderDetail, ...args);

/**
 * async function setNewOrder
 * Watcher에서 리스닝 하고 있는 큐에 변경된 주문의 키값을 넣어주는 함수
 * @param data : 주문 data ( Map )
 * @returns {Promise<any>}
 */
const setNewOrder = async (data) => {
    return await excClient.rpush(`${data.exchange}:watcher:newOrder`, data.id);
};
exports.setNewOrder = async (...args) => retryWrapper(setNewOrder, ...args);

/**
 * async function getPrice
 * 거래소의 특정 심볼에 대한 현재 가격을 가져오는 함수
 * @param exchange
 * @param symbol
 * @returns {Promise<any>}
 */
const getPrice = async (exchangeName, symbol) => {
    const price = await excClient.hget(`${exchangeName}:price`, symbol);
    const result = parseFloat(price);
    return result;
};
exports.getPrice = async(...args) => retryWrapper(getPrice, ...args);

const getUserSession = async (authToken, sessionType='connection') => {
    const data = await excClient.get(`user_session:${sessionType}:${authToken}`);
    if(data) {
        if(data.startsWith('{') || data.startsWith('[')) {
            return JSON.parse(data);
        }
    }
    return data;
};
exports.getUserSession = async(...args) => retryWrapper(getUserSession, ...args);

const setUserSession = async (authToken, data, expireTime, sessionType='connection') => {
    const inputData = (typeof data == 'object') ? JSON.stringify(data) : data;
    return await excClient.set(`user_session:${sessionType}:${authToken}`, inputData, 'EX', expireTime);
};
exports.setUserSession = async (...args) => retryWrapper(setUserSession, ...args);

const delUserSession = async (authToken, sessionType='connection') => {
    return await excClient.del(`user_session:${sessionType}:${authToken}`);
};
exports.delUserSession = async (...args) => retryWrapper(delUserSession, ...args);

const getAdminSession = async (authToken) => {
    const user = await excClient.get(`admin_session:${authToken}`);
    return JSON.parse(user);
};
exports.getAdminSession = async(...args) => retryWrapper(getAdminSession, ...args);

const setAdminSession = async (authToken, userData) => {
    return await excClient.set(`admin_session:${authToken}`, JSON.stringify(userData), 'EX', ADMIN_SESSION_EXPIRE_TIME);
};
exports.setAdminSession = async (...args) => retryWrapper(setAdminSession, ...args);


const delAdminSession = async (authToken) => {
    return await excClient.del(`admin_session:${authToken}`);
};
exports.delAdminSession = async (...args) => retryWrapper(delAdminSession, ...args);


/**
 * publicSocket 에서 필요한 데이 현재값을 계속 set을 해준다
 * @param symbol
 * @param currentPrice
 * @return {Promise<void>}
 */
const setCurrentPrice = async (exchange, symbol, currentPrice) => {
    await excClient.hset(`${exchange}:price`, symbol, currentPrice);
    return await excClient.rpush(`${exchange}:watcher:priceQueue`,JSON.stringify({symbol: symbol, price: currentPrice}));
};
exports.setCurrentPrice = async (...args) => retryWrapper(setCurrentPrice, ...args);

const setBaseExchangeRate = async(exchange, currency, value) => {
    return await excClient.hset(`${exchange}:BaseExchangeRate`, currency, value);
};
exports.setBaseExchangeRate = async (...args) => retryWrapper(setBaseExchangeRate, ...args);

const getAllBaseExchangeRate = async(exchange) => {
    return await excClient.hgetall(`${exchange}:BaseExchangeRate`);
};
exports.getAllBaseExchangeRate = async (...args) => retryWrapper(getAllBaseExchangeRate, ...args);

const setBaseExchangeRateList = async(exchange, dataValues) => {
    return await excClient.hmset(`${exchange}:BaseExchangeRate`, dataValues);
};
exports.setBaseExchangeRateList = async(...args) => retryWrapper(setBaseExchangeRateList, ...args);

const setUserBalance = async (userId, exchange, asset, balance, isVirtual=false) => {
    if(isVirtual == true) {
        return await excClient.hset(`${exchange}:userData:${userId}:virtual:balance`, asset, Math.round(balance*CONVERT_INTEGER_VALUE));
    }
    else {
        const convertBalance = {
            free: parseFloat(balance.free),
            locked: parseFloat(balance.locked)
        };
        return await excClient.hset(`${exchange}:userData:${userId}:actual:balance`, asset, JSON.stringify(convertBalance));
    }

};
exports.setUserBalance = async (...args) => retryWrapper(setUserBalance, ...args);

const deleteUserActualBalance = async (userId, exchange) => {
    return await excClient.del(`${exchange}:userData:${userId}:actual:balance`);
};
exports.deleteUserActualBalance = async (...args) => retryWrapper(deleteUserActualBalance, ...args);

const increaseVirtualUserBalance = async(userId, exchange, asset, balance) => {
    await excClient.hincrby(`${exchange}:userData:${userId}:virtual:balance`, asset, Math.round(balance*CONVERT_INTEGER_VALUE));
    return true;
};
exports.increaseVirtualUserBalance = async (...args) => retryWrapper(increaseVirtualUserBalance, ...args);

const getUserBalance = async (userId, exchangeName, asset, isVirtual = false) => {
    const exchangeTypeString = (isVirtual == true) ? 'virtual' : 'actual';
    const result = await excClient.hget(`${exchangeName}:userData:${userId}:${exchangeTypeString}:balance`, asset);
    if(!result) {
        return {free: 0, locked:0}
    }
    if(result.startsWith('{')) {
        return JSON.parse(result);
    }
    else {
        return {free: parseFloat((result/CONVERT_INTEGER_VALUE).toFixed(8)), locked:0};
    }
};
exports.getUserBalance = async (...args) => retryWrapper(getUserBalance, ...args);

const getUserAllBalance = async (exchangeName, userId) => {
    const actualBalance = await excClient.hgetall(`${exchangeName}:userData:${userId}:actual:balance`);
    const virtualBalance = await excClient.hgetall(`${exchangeName}:userData:${userId}:virtual:balance`);
    const result = {
        'actual': {},
        'virtual': {}
    };
    if(actualBalance) {
        for(const asset in actualBalance) {
            if(actualBalance[asset].free <= 0 && actualBalance[asset].locked <= 0) {
                continue;
            }
            result['actual'][asset] = JSON.parse(actualBalance[asset]);
        }
    }
    if(virtualBalance) {
        for(const asset in virtualBalance) {
            if(virtualBalance[asset].free <= 0) {
                continue;
            }
            result['virtual'][asset] = {free:parseFloat((virtualBalance[asset]/CONVERT_INTEGER_VALUE).toFixed(8)), locked:0};
        }
    }
    return result;
};
exports.getUserAllBalance = async (...args) => retryWrapper(getUserAllBalance, ...args);

exports.setUserFavoriteSymbols = async (exchangeName, userId, symbols) => {
    return await excClient.sadd(`${exchangeName}:userData:${userId}:favorites:symbol`, symbols);
};

exports.getUserFavoriteSymbols = async (exchangeName, userId) => {
    return await excClient.smembers(`${exchangeName}:userData:${userId}:favorites:symbol`);
};

exports.getUserFavoriteSymbolCount = async (exchangeName, userId) => {
    return await excClient.scard(`${exchangeName}:userData:${userId}:favorites:symbol`);
};

exports.deleteUserFavoriteSymbols = async (exchangeName, userId, symbols) => {
    return await excClient.srem(`${exchangeName}:userData:${userId}:favorites:symbol`, symbols);
};

const getCurrentPriceAndTick = async(exchangeName, symbol) => {
    const tickSize = await this.getTickSize(exchangeName, symbol);
    const currentPrice = await this.getCurrentPrice(exchangeName, symbol);
    return [currentPrice, tickSize];
};
exports.getCurrentPriceAndTick = async (...args) => retryWrapper(getCurrentPriceAndTick, ...args);

const getTickSize = async (exchangeName, symbol) => {
    const result = await excClient.hget(`${exchangeName}:marketData`, symbol);
    const parseData = JSON.parse(result);
    return parseData['tickSize'];
};
exports.getTickSize = async (...args) => retryWrapper(getTickSize, ...args);

const getCurrentPrice = async (exchangeName, symbol) => {
    return await excClient.hget(`${exchangeName}:price`,`${symbol}`);
};
exports.getCurrentPrice = async (...args) => retryWrapper(getCurrentPrice, ...args);

/**
 * async function pushApiProxyQueue
 * api proxy queue에 새로운 api를 입력하는 함수
 * @param key
 * @returns {Promise<*>}
 */
const pushApiProxyQueue = async (key) => {
    return await apiProxyClient.rpush('api_proxy:post_q', key);
};
exports.pushApiProxyQueue = async (...args) => { return await retryWrapper(pushApiProxyQueue, ...args)};

/**
 * async function listenApiProxyResponse
 * api proxy의 리턴값을 리스닝 하는 함수
 * @param id
 * @returns {Promise<*>}
 */
const listenApiProxyResponse = async (id, timeout) => {
    const tempClient = asyncRedis.decorate(redis.createClient(config.redis.proxy_info));
    const key = `api_proxy:res:${id}`;
    const result = await tempClient.blpop(key, timeout);
    tempClient.quit();
    return result;
};
exports.listenApiProxyResponse = listenApiProxyResponse;

const listenTelegramResponse = async (id, timeout) => {
    const tempClient = asyncRedis.decorate(redis.createClient(config.redis.proxy_info));
    const key = `telegram:res:${id}`;
    const [QueueName, result] = await tempClient.blpop(key, timeout);
    tempClient.quit();
    return result;
};
exports.listenTelegramResponse = listenTelegramResponse;

const pushTelegramQueue = async (dataString) => {
    return await apiProxyClient.rpush('telegram:req', dataString);
};
exports.pushTelegramQueue = pushTelegramQueue;


const pushMailerQueue = async (dataString) => {
    return await apiProxyClient.rpush('mailer:queue', dataString);
};

exports.pushMailerQueue = async (...args) => { return await retryWrapper(pushMailerQueue, ...args)};

const pushQueue = async (path, data) => {
    return await excClient.rpush(path, data);
};
exports.pushQueue = pushQueue;

const listenQueue = async (path, callback) => {
    let [queueName, result] = await listenClient.blpop(path, 0).catch(async(err) => {
        console.log(err);
        return await listenQueue(path, callback);
    });
    callback(result);
    return await listenQueue(path, callback);
};

const listenTempQueue = async (path, timeout) => {
    const tempClient = asyncRedis.decorate(redis.createClient(config.redis.base_info));
    const result = await tempClient.blpop(path, timeout);
    tempClient.quit();
    return result;
};
exports.listenTempQueue = listenTempQueue;

const listenQueueSync = async(path, callback) => {
    let [queueName, result] = await listenClient.blpop(path, 0).catch(async(err) => {
        console.log(err);
        return await listenQueueSync(path, callback);
    });
    await callback(result);
    return await listenQueueSync(path, callback);
};
if(listenClient) {
    exports.listenQueue = listenQueue;
    exports.listenQueueSync = listenQueueSync;
}

const setPacketSession = async(userName, inputUrl, inputData) => {
    const key = `packetSession:${userName}:${inputUrl}`;
    return await excClient.set(key, JSON.stringify(inputData), 'EX', PACKET_SESSION_EXPIRE_TIME);
};
exports.setPacketSession = setPacketSession;

const getPacketSession = async(userName, inputUrl) => {
    const key = `packetSession:${userName}:${inputUrl}`;
    return await excClient.get(key);
};
exports.getPacketSession = getPacketSession;

const addZscoreTable = async(table, userInfo, score) => {
    return await excClient.zadd(table, score, userInfo);
};
exports.addZscoreTable = async (...args) => { return await retryWrapper(addZscoreTable, ...args)};

const incrementZscoreTable = async(table, userInfo, score) => {
    return await excClient.zincrby(table, score, userInfo);
};
exports.incrementZscoreTable = async (...args) => { return await retryWrapper(incrementZscoreTable, ...args)};

const getRankZscoreTable = async(table, userInfo) => {
    return await excClient.zrevrank(table, userInfo);
};
exports.getRankZscoreTable = async (...args) => { return await retryWrapper(getRankZscoreTable, ...args)};

const getRankWithScore = async(table, startRank, endRank, replaceUserName = false) => {
    const result = await excClient.zrevrange(table, startRank-1, endRank-1, 'withscores');
    const rankList = [];
    for(let i=0; i < result.length; i+=2) {
        let userName = result[i].split('||')[0];
        if(replaceUserName == true) {
            const subStringAt = (userName.length > 3) ? 2 : 1;
            let convertString = userName.substring(subStringAt, userName.length-1).replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/gi, '*').replace(/\w/gi, '*');
            if(convertString.length > 5) {
                convertString = '***';
            }
            userName = userName.substring(0, subStringAt) + convertString + userName[userName.length-1];
        }
        rankList.push({userName:userName, rateOfReturn: parseFloat(parseFloat(result[i+1]).toFixed(2))});
    }
    return rankList;
};
exports.getRankWithScore = async (...args) => { return await retryWrapper(getRankWithScore, ...args)};

const setAdminDashBoardData = async (type, data, exchange = 'public') => {
    return await excClient.hset(`admin:dashBoard:${exchange}`, type, JSON.stringify(data));
};
exports.setAdminDashBoardData = async(...args) => retryWrapper(setAdminDashBoardData, ...args);


const getAdminDashBoardData = async (type, exchange = 'public') => {
    const dashBoardData = await excClient.hget(`admin:dashBoard:${exchange}`, type);
    return JSON.parse(dashBoardData);
};
exports.getAdminDashBoardData = async(...args) => retryWrapper(getAdminDashBoardData, ...args);

const getAdminDashBoardDataByMultiField = async (types, exchange = 'public') => {
    const dashBoardDataList = await excClient.hmget(`admin:dashBoard:${exchange}`, types);
    const result = [];
    for(const dashBoardData of dashBoardDataList){
        result.push(JSON.parse(dashBoardData));
    }
    return result;
};
exports.getAdminDashBoardDataByMultiField = async(...args) => retryWrapper(getAdminDashBoardDataByMultiField, ...args);


const delAdminDashBoardData = async (types, exchange) => {

    return await excClient.hdel(`admin:dashBoard:${exchange}`, types);
};
exports.delAdminDashBoardData = async(...args) => retryWrapper(delAdminDashBoardData, ...args);


