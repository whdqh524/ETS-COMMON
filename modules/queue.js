'use strict'

const Queue = require('better-queue');

async function baseFunc (job, callback) {
    await job();
    await callback();
}

class SeqQueue extends Queue {
    constructor() {
        super(baseFunc);
        this.on('task_finish', this.completJob);
    }

    async push(job, ...args) {
        const promises = [];
        for(const key in this._tickets) {
            promises.push(this.cancel(key));
        }
        await Promise.all(promises);
        super.push(async () => {
            await job(...args);
        })
    }

    async pushNormal(job, ...args) {
        super.push(async () => {
            await job(...args);
        });
    }

    async completJob(taskId, result, stats) {
        // console.log(`taskId : ${taskId}, result: ${result}`);
    }
}

module.exports = SeqQueue;
