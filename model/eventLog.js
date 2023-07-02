'use strict';

const mongoose = require("mongoose");
const mSchema = mongoose.Schema;


const eventLogSchema = new mSchema({
    userName: {type: String, required: true, index: true},
    orderId: {type: String, required: true,  index: true},
    eventType: {type: String, required: true, index: true},
    eventContent: {type: mSchema.Types.Mixed, required: true},
    createdAt: {type: Date, required: true},
});

module.exports = (connectionPool) => {
    let model = connectionPool.model('EventLog', eventLogSchema);
    return model;
};







