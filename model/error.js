'use strict';

const mongoose = require("mongoose");
const mSchema = mongoose.Schema;


const errorLogSchema = new mSchema({
    userName: {type: String, required: false, index: true},
    orderPlanId: {type: String, required: false, index: true},
    orderId: {type: String, required: false, index: true},
    userAgent: {type: String},
    serverIp: {type: String},
    clientIp: {type: String},
    exchange: {type: String, required: true},
    description: {type: String},
    errorType: {type: String, required: true, index: true},
    errorMessage: {type: String},
    stack: {type: mSchema.Types.Mixed},
    createdAt: {type: Date, required: true},
});

module.exports = (connectionPool) => {
    let model = connectionPool.model('ErrorLog', errorLogSchema);
    return model;
};