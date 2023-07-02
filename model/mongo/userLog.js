const mongoose = require('mongoose');
const mSchema = mongoose.Schema;
const redisCtrl = require('../../modules/redisCtrl');

const userLogSchema = new mongoose.Schema({
            userId: {type: String, required: false, index: true},
            type: {type: String},
            subAction: {type: String},
            action: {type: String, index: true},
            country:{type: String},
            content: {type: mSchema.Types.Mixed, default: '-'},
            createdAt: {type: Date, required: true},
});

userLogSchema.index({'userId': 1, 'action': -1});
userLogSchema.index({'action': 1, subAction: -1});
userLogSchema.index({'country': 1});
userLogSchema.index({'createdAt': 1});

userLogSchema.statics.makeNew = async function(action, infoData, content) {
    const saveUserLogForm = {
        userId: infoData.user.email,
        type: infoData.type,
        subAction: infoData.subAction ? infoData.subAction : '-',
        action: action,
        country: infoData.user.country,
        content: content,
        createdAt: new Date(),
    };
    await this.create(saveUserLogForm);
};



userLogSchema.statics.setUserSignoutReason = async function(startDate, nowDate){
    const result = {
        MY_INFORMATION_DELETE_ACCOUNT_CHANGE: {
            count: 0,
            content: [],
        },
        MY_INFORMATION_DELETE_ACCOUNT_DONT: {
            count: 0,
            content: [],
        },
        MY_INFORMATION_DELETE_ACCOUNT_INCOVENIENT: {
            count: 0,
            content: [],
        },
        MY_INFORMATION_DELETE_ACCOUNT_DISSATIS: {
            count: 0,
            content: [],
        },
        MY_INFORMATION_DELETE_ACCOUNT_INSUFFI:{
            count: 0,
            content: [],
        },
        MY_INFORMATION_DELETE_ACCOUNT_LOW: {
            count: 0,
            content: [],
        },
        MY_INFORMATION_DELETE_ACCOUNT_OTHERS:{
            count: 0,
            content: [],
        },
    };
    const signOutLogs = await this.aggregate([
        {$match: {
                $and: [
                    {action: 'SIGNOUT'},
                    {createdAt: {$gt: startDate, $lte: nowDate}},
                ]}},
        {$group: {
                _id: {
                    subAction:"$subAction",
                },
                count:{$sum:1},
                content :{$push: "$content"},

            }
        },
    ]);
    if(signOutLogs.length === 0) return await redisCtrl.setAdminDashBoardData('userSignOutReasonStatus', result);

    for(const signOutLog of signOutLogs){
        result[signOutLog['_id'].subAction]['count'] = signOutLog.count;
        result[signOutLog['_id'].subAction]['content'] = signOutLog.content;
    }
    await redisCtrl.setAdminDashBoardData('userSignOutReasonStatus', result);
};


userLogSchema.statics.setUserSignUpCountryStatus = async function(startDate, nowDate){
    const result = {};
    const signUpLogs = await this.aggregate([
        {$match: {
                $and: [
                    {action: 'SIGNUP'},
                    {createdAt: {$gt: startDate, $lte: nowDate}},
                ]}},
        {
            $group: {
                _id: {
                    country:"$country",
                },
                count:{$sum:1}
            }
        }
    ]);
    if(signUpLogs.length === 0) return await redisCtrl.setAdminDashBoardData('userSignUpCountryStatus', result);
    for(const signUpLog of signUpLogs){
        if(!signUpLog._id.country) continue;
        result[signUpLog._id.country] = signUpLog.count;
    }
    await redisCtrl.setAdminDashBoardData('userSignUpCountryStatus', result);
};

userLogSchema.statics.setUserCurrentStatus = async function(startDate, nowDate){
    const result = {
        ALIVE: 0,
        SLEEP_INTENDED: 0,
        SLEEP: 0,
        BLOCK: 0,
        SIGNOUT: 0,
        AUTOWITHDRAW: 0,
        ERROR: 0,
    };
    const userStatusDatas = await this.aggregate([
        {$match: {
                $and: [
                    {type: 'USER_STATUS'},
                    {createdAt: {$gt: startDate, $lte: nowDate}},
                ]}},
        {
            $group: {
                _id:"$action",
                count:{$sum:1}
            }
        }
    ]);
    if(userStatusDatas.length === 0) return await redisCtrl.setAdminDashBoardData('userStatus', result);
    for(const userStatusData of userStatusDatas){
        if(userStatusData._id === 'SIGNUP'){
            result['ALIVE'] = parseInt(userStatusData.count);
        }else{
            result[userStatusData._id] = parseInt(userStatusData.count);
        }
    }
    await redisCtrl.setAdminDashBoardData('userStatus', result);
};



module.exports = (connectionPool) => {
    return connectionPool.model('UserLog', userLogSchema);
};





