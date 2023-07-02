const mongoose = require('mongoose');
const mSchema = mongoose.Schema;
const redisCtrl = require('../../modules/redisCtrl');



const errorSchema = new mSchema({
    serverName: {type: String},
    errorName: {type: String},
    errorMessage: {type: String},
    errorType: {type: String},
    stack: {type: mSchema.Types.Mixed},
    content: {type: mSchema.Types.Mixed},
    createdAt: {type: Date, required: true},
});

errorSchema.index({errorType: -1});

errorSchema.statics.makeNew = async function(errorLogForm) {
    const saveErrorLogForm = {
        serverName: errorLogForm.serverName,
        errorName: errorLogForm.errorName,
        errorMessage: errorLogForm.errorMessage,
        errorType: errorLogForm.errorType,
        stack: errorLogForm.stack,
        content: errorLogForm.content,
        createdAt: errorLogForm.createdAt,
    };
    await this.create(saveErrorLogForm);
};

errorSchema.statics.setErrorLogCount = async function(startDate, nowDate){
    const result = {};
    const errorLogs = await this.aggregate([
        {$match: {
                $and: [
                    {createdAt: {$gt: startDate, $lte: nowDate}},
                ]}},
        {$group: {
                _id: {errorType: "$errorType"},
                count:{$sum:1},
            }},
    ]);
    if(errorLogs.length === 0) return await redisCtrl.setAdminDashBoardData('errorCount', result);
    for(const errorLog of errorLogs){
        result[errorLog._id.errorType.toUpperCase()] = errorLog.count;
    }
    await redisCtrl.setAdminDashBoardData('errorCount', result);
};



module.exports = (connectionPool) => {
    return connectionPool.model('ErrorLog', errorSchema);
};





