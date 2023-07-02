'use strict';

const Zookeeper =  require('zookeeper');
const config = require('../config');
const { timeout } = require('./utils');
const logger = require('./logger');


let instance = null;
const rootPath = `/coinbutler`;

class ZookeeperManager extends Zookeeper {
    constructor(config) {
        super(config);
        this.on('connect', async () => {
            await this.checkRequiredPath();
        });
        this.init(config);
    }

    async checkRequiredPath() {
        try {
            await this.exists(`${rootPath}`).catch(async(err) => {
                await this.create(rootPath, {}, Zookeeper.ZOO_PERSISTENT);
            });
            await this.exists(`${rootPath}/privateSocketServers`).catch(async(err) => {
                await this.create(`${rootPath}/privateSocketServers`, {}, Zookeeper.ZOO_PERSISTENT);
            });
            for(const exchangeName of config.exchangeList) {
                await this.exists(`${rootPath}/privateSocketServers/${exchangeName}`).catch(async(err) => {
                    await this.create(`${rootPath}/privateSocketServers/${exchangeName}`, {}, Zookeeper.ZOO_PERSISTENT);
                });
            }
            await this.exists(`${rootPath}/socketConnectedUserMap`).catch(async(err) => {
                await this.create(`${rootPath}/socketConnectedUserMap`, {}, Zookeeper.ZOO_PERSISTENT);
            });
            await this.exists(`${rootPath}/internalSocketServers`).catch(async(err) => {
                await this.create(`${rootPath}/internalSocketServers`, {}, Zookeeper.ZOO_PERSISTENT);
            });
        }
        catch (e) {
            console.log(e);
        }
    }

    async registPrivateSocketServer(exchangeName, serverIp) {
        const result = await this.create(`${rootPath}/privateSocketServers/${exchangeName}/${serverIp}`, {}, Zookeeper.ZOO_EPHEMERAL).catch(async (err) => {
            if(err.message == "-110 node exists") {
                await timeout(2000);
                return this.registPrivateSocketServer(exchangeName, serverIp);
            }
            throw err;
        });
        console.log(result);
    }

    async getPrivateSocketServerList (exchangeName) {
        const serverList = await this.get_children(`${rootPath}/privateSocketServers/${exchangeName}`);
        return serverList;
    }

    async registInternalSocketUser(userId, serverIp, sessionKey) {
        try {
            await this.exists(`${rootPath}/socketConnectedUserMap/${userId}`).catch(async(err) => {
                await this.create(`${rootPath}/socketConnectedUserMap/${userId}`, {}, Zookeeper.ZOO_PERSISTENT);
            });
            await this.exists(`${rootPath}/socketConnectedUserMap/${userId}/${serverIp}`).catch(async(err) => {
                await this.create(`${rootPath}/socketConnectedUserMap/${userId}/${serverIp}`, {}, Zookeeper.ZOO_EPHEMERAL);
            });
            await this.exists(`${rootPath}/socketConnectedUserMap/${userId}/sessionList`).catch(async(err) => {
                await this.create(`${rootPath}/socketConnectedUserMap/${userId}/sessionList`, {}, Zookeeper.ZOO_PERSISTENT);
            });
            await this.exists(`${rootPath}/socketConnectedUserMap/${userId}/sessionList/${sessionKey}`).catch(async(err) => {
                await this.create(`${rootPath}/socketConnectedUserMap/${userId}/sessionList/${sessionKey}`, {}, Zookeeper.ZOO_EPHEMERAL);
            });
        }
        catch(e) {
            console.log(e);
        }
    }

    async registInternalSocketServer(serverIp) {
        try {
            await this.create(`${rootPath}/internalSocketServers/${serverIp}`, {}, Zookeeper.ZOO_EPHEMERAL).catch(async (err) => {
                if(err.name == "-110 node exists") {
                    await timeout(2000);
                    return this.registInternalSocketServer(serverIp);
                }
                throw err;
            });
        }
        catch (e) {
            console.log(e);
        }
    }

    async getUserSessionList(userId) {
        return await this.get_children(`${rootPath}/socketConnectedUserMap/${userId}/sessionList`);
    }

    async getUserConnectedInternalSocket (userId) {
        return await this.get_children(`${rootPath}/socketConnectedUserMap/${userId}`).catch((e) => {return [];});
    }

    async removeInternalSocketUser(userId, serverIp, sessionKey) {
        const sessionPath = `${rootPath}/socketConnectedUserMap/${userId}/sessionList/${sessionKey}`
        await this.delete_(sessionPath).catch(async (e) => {
            if(e) {
                await logger.infoConsole('[zkCtrl:Remove]', {path:sessionPath});
            }
        });
        const sessionList = await this.get_children(`${rootPath}/socketConnectedUserMap/${userId}/sessionList`);
        if(sessionList.length == 0) {
            await this.delete_(`${rootPath}/socketConnectedUserMap/${userId}/${serverIp}`).catch(async (e) => {
                if(e) {
                    await logger.infoConsole('[zkCtrl:Remove]', {path:`${rootPath}/socketConnectedUserMap/${userId}/${serverIp}`});
                }
            })
        }
    }

    static getInstance () {
        if(instance === null) {
            instance = new ZookeeperManager({
                connect: `${config.zookeeper.uri}:${config.zookeeper.port}`,
            });
        }
        return instance;
    }
}

module.exports = ZookeeperManager.getInstance();