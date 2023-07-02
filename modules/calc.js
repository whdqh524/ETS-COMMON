'use strict';

const { ORDER_SIDE, TRADE_TYPE, CLOSE_INDICATOR_TYPE } = require('../enum');

const triggerPrice = function(enterPrice, slippage, orderLimit, side, tickSize) {
    const roundValue = 1 / tickSize;
    const price = parseFloat(enterPrice) + (parseFloat(enterPrice) * slippage * TRADE_TYPE[orderLimit] * ORDER_SIDE[side]);
    return Math.round(price * roundValue) / roundValue;
};
exports.triggerPrice = triggerPrice;

const actualPrice = function(enterPrice, slippage, orderLimit, side, tickSize) {
    const roundValue = Math.round(1 / tickSize);
    const price = parseFloat(enterPrice) + (parseFloat(enterPrice) * slippage * (TRADE_TYPE[orderLimit] ? 0 : 1) * ORDER_SIDE[side]);
    return  Math.round(price * roundValue) / roundValue;
};
exports.actualPrice = actualPrice;

const cancelPrice = function(enterPrice, slippage, orderLimit, side, tickSize) {
    const roundValue = Math.round(1 / tickSize);
    const price = parseFloat(enterPrice) + (parseFloat(enterPrice) * slippage * 1.5 * TRADE_TYPE[orderLimit] * ORDER_SIDE[side]);
    return  Math.round(price * roundValue) / roundValue;
};
exports.cancelPrice = cancelPrice;

exports.trendLinePrice = function(openPrice, percentage, slippage, orderLimit, indicatorType, side, tickSize) {
    const roundValue = Math.round(1 / tickSize);
    const price = parseFloat(openPrice) + (parseFloat(openPrice) * percentage * CLOSE_INDICATOR_TYPE[indicatorType] * ORDER_SIDE[side] * -1);
    const enterPrice = Math.round(price * roundValue) / roundValue;
    const result = {
        enterPrice: enterPrice,
        triggerPrice: (this.isVirtual == true) ? enterPrice :
            triggerPrice(enterPrice, slippage, orderLimit, side, tickSize),
        actualPrice: enterPrice,
        cancelPrice: cancelPrice(enterPrice, slippage, orderLimit, side, tickSize)
    };
    return result;
};

exports.getOrderValue = function (enterPrice, filledQty, filledAmount, symbol){
    let orderValue = 0;
    if(filledQty > 0) {
        const price = filledAmount / filledQty;
        orderValue = (symbol.match('ETH')) ? price * (0.000001 * filledQty) : filledQty / price;
    }else {
        const price = enterPrice;
        if(!price) {
            orderValue = 0;
        }else {
            orderValue = (symbol.match('ETH')) ? price * (0.000001 * filledQty) : filledQty / price;
        }
    }
    return orderValue
}