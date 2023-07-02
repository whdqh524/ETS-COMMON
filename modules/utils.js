"use strict";

const config = require('../config');
const axios = require('axios');
const crypto = require('crypto');
const { Parser } = require('json2csv');
const { RETRY_VALUE } = require('../enum');

function timeout(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
exports.timeout = timeout;

function encrypt(input, encryptKey) {
    let md5Hash = crypto.createHash('md5');
    md5Hash.update(encryptKey);
    let key = md5Hash.digest('hex');
    md5Hash = crypto.createHash('md5');
    md5Hash.update(encryptKey + key);
    const iv = md5Hash.digest('hex');
    const data = new Buffer.from(input, 'utf8').toString('binary');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv.slice(0,16));
    const nodev = process.version.match(/^v(\d+)\.(\d+)/);
    let encrypted;
    if( nodev[1] === '0' && parseInt(nodev[2]) < 10) {
        encrypted = cipher.update(data, 'binary') + cipher.final('binary');
    } else {
        encrypted = cipher.update(data, 'utf8', 'binary') + cipher.final('binary');
    }
    const encoded = new Buffer.from(encrypted, 'binary').toString('base64');
    return encoded;
}
exports.encrypt = encrypt;

function decrypt(input, encryptKey) {
    let inputString = input.replace(/\-/g, '+').replace(/_/g, '/');
    const edata = new Buffer.from(inputString, 'base64').toString('binary');
    let md5Hash = crypto.createHash('md5');
    md5Hash.update(encryptKey);
    const key = md5Hash.digest('hex');
    md5Hash = crypto.createHash('md5');
    md5Hash.update(encryptKey + key);
    const iv = md5Hash.digest('hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv.slice(0,16));
    const nodev = process.version.match(/^v(\d+)\.(\d+)/);
    let decrypted, plainText;
    if( nodev[1] === '0' && parseInt(nodev[2]) < 10) {
        decrypted = decipher.update(edata, 'binary') + decipher.final('binary');
        plainText = new Buffer.from(decrypted, 'binary').toString('utf8');
    } else {
        plainText = (decipher.update(edata, 'binary', 'utf8') + decipher.final('utf8'));
    }
    return plainText;
}
exports.decrypt = decrypt;

exports.cipherAPIkey = (apiKey, secretKey, salt) => {
    return {
        apiKey: encrypt(apiKey, salt),
        secretKey: encrypt(secretKey, salt)
    };
};

exports.decipherAPIkey = (apiKey, secretKey, salt) => {
    return {
        apiKey: decrypt(apiKey, salt),
        secretKey: decrypt(secretKey, salt)
    };
};

exports.dynamicSortDesc = function (property) {
    let sortOrder = 1;
    if(property[0] === "-") {
        sortOrder = -1;
        property = property.substr(1);
    }
    return function (b,a) {
        const result = (a[property] < b[property]) ? -1 : (a[property] > b[property]) ? 1 : 0;
        return result * sortOrder;
    }
};

exports.getDate = (x) => {
    const a = new Date(x);return (a.getMonth()+1+'월 '+ a.getDate()+'일 '+a.getHours()+'시 '+a.getMinutes()+'분');
};

exports.convertDateString = (d) => {
    let str = d;
    const year = str.substring(0, 4);
    const month = str.substring(4, 6);
    const day = str.substring(6, 8);
    const hour = str.substring(8, 10);
    const minute = str.substring(10, 12);
    const second = str.substring(12, 14);
    const date = new Date(year, month-1, day, hour, minute, second).getTime();
    return date;
};

async function retryAPISend (options, retryCount) {
    let result = await axios(options)
        .catch(async (e) => {
            retryCount--;
            if(retryCount > 0) {
                await timeout(1000);
                return retryAPISend(options, retryCount)
            }
            return {err:new AxiosError(), result:result};
        });
    return {err:null, axiosResponse:result};
}
module.exports.retryAPISend = retryAPISend;

function timestampDate(timestamp){
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = date.getMonth()+1;
    const day = date.getDate();
    const hour = date.getHours();
    const min = date.getMinutes();
    const sec = date.getSeconds();
    const retVal =   year + "-" + (month < 10 ? "0" + month : month) + "-"
        + (day < 10 ? "0" + day : day) + " "
        + (hour < 10 ? "0" + hour : hour) + ":"
        + (min < 10 ? "0" + min : min) + ":"
        + (sec < 10 ? "0" + sec : sec);
    return retVal
}
exports.timestampDate = timestampDate;


function  countryTimeDate(timestamp, timezone){
    const lastDate = parseInt(timestamp) + (timezone * 60 * 60 * 1000);
    return timestampDate(lastDate);
}
exports.countryTimeDate = countryTimeDate;

exports.retryWrapper = async (func, ...args) => {
    return await retryFunc(RETRY_VALUE.RETRY_COUNT, func, ...args);
};

async function retryFunc (retryCount, func, ...args) {
    return await func(...args).then(async(result) => {
        if(result) {
            return result;
        }
        if(retryCount > 0) {
            retryCount--;
            await timeout(RETRY_VALUE.RETRY_TIMEOUT);
            return await retryFunc(retryCount, func, ...args);
        }
        else {
            return undefined;
        }
    }).catch(async (err) => {
        if(retryCount > 0) {
            retryCount--;
            await timeout(RETRY_VALUE.RETRY_TIMEOUT);
            return await retryFunc(retryCount, func, ...args);
        }
        throw err;
    });
}

exports.genNumber = (r) => {
    for(let a="",t="123456789".length, n=0; n<r; n++) {
        a+="123456789".charAt(Math.floor(Math.random()*t));
        return parseFloat(a)
    }
};

exports.roundTicker = (t_size, length, value) => {
    let t = 1 / t_size;
    const result = (Math.round(value * t) / t).toFixed(length);
    return parseFloat(result);
};

exports.floorTicker = (t_size, length, value) => {
    let t = 1 / t_size;
    const result = (Math.floor(value * t) / t).toFixed(length);
    return parseFloat(result);
};

exports.symbolChange = (symbol) => {
    let data = symbol.split('-');
    return `${data[0]}${data[1]}`;
};

exports.symbolDevide = (symbol) => {
    let base, quote;
    base = symbol.slice(0, symbol.length - 3);
    quote = symbol.slice(symbol.length-3, symbol.length);
    return `${base}-${quote}`;
};

exports.convertSatoshiValue = (value, length) => {
    const tempValue = value*0.00000001;
    const removeValue = parseFloat((tempValue % Math.pow(0.1, length).toFixed(length)).toFixed(8));
    return (tempValue-removeValue).toFixed(length);
};

exports.defaultSatoshiValue = (value) => {
    if(!value) return;
    const decimalPlaces = value.toString().split('.')[1];
    return parseFloat(value).toFixed(decimalPlaces && decimalPlaces.length > 8 ? decimalPlaces.length : 8)
};

let serverIp, os = require('os'), ifaces = os.networkInterfaces();

for (let dev in ifaces) {
    let iface = ifaces[dev].filter(function(details) {
        return details.family === 'IPv4' && details.internal === false;
    });
    if(iface.length > 0) {
        serverIp = iface[0].address;
    }
}
exports.serverIp = serverIp;

function randomString() {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
    const string_length = 30;
    let randomstring = '';
    for (let i=0; i<string_length; i++) {
        const rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum,rnum+1);
    }
    return randomstring;
}
exports.randomString = randomString;

exports.generateTokenString = function(authentication, encryptString) {
    const token = `${randomString()}:${authentication}`;
    return encrypt(token, encryptString);
};

exports.decryptTokenString = function(token, encyptString) {
    return decrypt(token, encyptString);
};


exports.objectCompare = function objectCompalre(object1, object2) {
    const object1KeyLength = Object.keys(object1).length;
    const object2KeyLength = Object.keys(object2).length;
    if(object1KeyLength !== object2KeyLength) {
        return false;
    }
    for(const key in object1){
        if(object1.hasOwnProperty(key)){
            if(object1[key] !== object2[key]){
                return false;
            }
        }
    }
    for(const key in object2){
        if(object2.hasOwnProperty(key)){
            if(object1[key] !== object2[key]){
                return false;
            }
        }
    }
    return true;
};

exports.downloadResource = function (res, fileName, fields, data) {
    const json2csv = new Parser({ fields });
    const csv = json2csv.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment(fileName);
    return res.send(csv);
};

if(!String.prototype.format) {
    String.prototype.format = function() {
        "use strict";
        if (arguments.length) {
            const t = typeof arguments[0];
            const args = ("string" === t || "number" === t) ?
                Array.prototype.slice.call(arguments)
                : arguments[0];
            return this.replace(/{([^}]*)}/g, function(match, key) {
                if(typeof args[key] !== "undefined") return key === 'exchange' && args[key] === 'okex' ? 'okx' : args[key];
                    throw new Error(`String Format Key Error  ['${key}']`);
            });
        }
    }
}


