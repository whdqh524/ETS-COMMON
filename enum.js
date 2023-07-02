'use strict';

exports.ORDER_ALIVE = {
    CANCELED: -2,
    COMPLETE: -1,
    WAITING: 0,
    ACTIVE: 1,
    STOP_BY_USER: 2,
    STOP_BY_ERROR: 3,
    STOP_AFTER_TRADE: 4,
    COMPLETE_AFTER_TRADE: 5
};



exports.ORDER_STATUS = [
    'WAITING',
    'PENDING',
    'PARTIALLY_FILLED',
    'PARTIALLY_FILLED_FEW',
    'COMPLETE',
    'CANCELED',
    'COMPLETE_CANCEL',
    'TRAILING'
];

exports.ORDER_ERROR = {
    MIN_NOTIONAL: 1001,
    NOT_ENOUGH_BALANCE: 1002,
    UNKNOWN_ERROR: 10000
};

exports.RETRY_VALUE = {
    RETRY_COUNT : 3,
    RETRY_TIMEOUT: 500
};

exports.TRADE_TYPE = {
    Limit : 1,
    Market : 0,
    Stop: -1,
    StopLimit: 1,
    TakeProfitMarket: 0,
    TakeProfitLimit: 1,
    Trail: 1
};

exports.CLOSE_INDICATOR_TYPE = {
    TAKE: 1,
    TRAIL: 1,
    LOSS: -1
};

exports.ORDER_SIDE = {
    BUY: 1,
    SELL: -1,
};

exports.ADMIN_ACCOUNT = {
    ADMIN_ID : 'Traum_cto',
};

exports.REALITYTYPE_WORD_MAP = {
    ko: {
        0: '실제',
        1: '가상',
    },
    en: {
        0: 'Actual',
        1: 'Virtual',
    }
};

exports.INDICATORTYPE_WORD_MAP = {
    OPEN: {
        ko: '오픈',
        en: 'Open',
    },
    TAKE: {
        ko: '익절',
        en: 'Take Profit',
    },
    LOSS: {
        ko: '손절',
        en: 'Stop Loss',
    },
    TRAIL: {
        ko: '트레일링',
        en: 'Trailing',
    },
    SELLMARKETNOW: {
        ko: '시장가 판매',
        en: 'Sell MarketNow',
    },
    CLOSE :{
        ko: '클로즈',
        en: 'Close',
    }
};

exports.CONVERT_INTEGER_VALUE = 100000000;
exports.USER_SESSION_EXPIRE_TIME = 14400;
exports.ADMIN_SESSION_EXPIRE_TIME = 3600;
exports.USER_TEMP_SESSION_EXPIRE_TIME = 180;
exports.PACKET_SESSION_EXPIRE_TIME = 2;
exports.SLIPPAGE_DEFAULT = 0.3;
exports.ORDER_STOPPX = 1;
exports.MAX_COMMISSION = 0.1;
exports.ONGOING_ORDER_LIMIT = 15;
exports.COMPLETE_ORDER_LIMIT = 30;

