const mongoose = require('mongoose');
const mSchema = mongoose.Schema;


const adminLogSchema = new mongoose.Schema({
    accountId: {type: String, required: true, index: true},
    type: {type: String, required: true, index: true},
    menuType: {type: String,required: true, index: true},
    uniqueId: {type: String, index: true},
    action: {type: String, required: true, index: true},
    content: {type: mSchema.Types.Mixed},
    createdAt: {type: Date, required: true},
});

adminLogSchema.index({accountId: 1});
adminLogSchema.index({type: 1});
adminLogSchema.index({menuType: 1, uniqueId: -1, action: -1});


adminLogSchema.statics.makeNew = async function(action, infoData, content){
    const adminLog = {
        accountId: infoData.accountId,
        type: infoData.type,
        menuType: infoData.menuType,
        uniqueId: infoData.uniqueId,
        action: action,
        content: content,
        createdAt: new Date().getTime(),
    };
    return this.create(adminLog);
};


module.exports = (connectionPool) => {
    return connectionPool.model('AdminLog', adminLogSchema);
};





