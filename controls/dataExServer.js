/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2019/1/25
 * Description : Servers control
 */

var ControlBase = require('./controlBase');
var DataExServersModel = require('../models/dataExServer');
const Schedule = require('node-schedule');
var request = require('request');
 
var DataExServersCtrl = function() {};
DataExServersCtrl.__proto__ = ControlBase;
DataExServersCtrl.model = DataExServersModel;

module.exports = DataExServersCtrl;

DataExServersCtrl.init = function () {
    console.log('DataExServers timer started!');
    var rule = new Schedule.RecurrenceRule();

    // 启动的时候先检测一次
    DataExServersCtrl.getAll(function (err, items) {
        if (err) {
            console.error('Initial check failed:', err);
            return;
        }
        checkDataExServer(items).then(r => {
            console.log("Initial check finished at:", new Date());
        }).catch(e => {
            console.error('Initial check error:', e);
        });
    });
    
    // 每15分钟执行一次
    rule.minute = [0,15,30,45];

    // 更新数据容器状态
    Schedule.scheduleJob(rule, () => {
        console.log('---Schedule jobs:' + new Date());
        console.log('---update DataExServers status');
        DataExServersCtrl.getAll(function (err, items) {
            checkDataExServer(items).then(r =>
                console.log("check data container status finished at : " + new Date()));
        })
    });
}


DataExServersCtrl.getAll = function (callback) {
    DataExServersCtrl.getByWhere({}, this.returnFunction(callback, 'Error in getting all data exchange server!'));
}

DataExServersCtrl.getAllByStatus = function (status,callback) {
    DataExServersCtrl.getByWhere({ds_status:status}, this.returnFunction(callback, 'Error in getting all data exchange server!'));
}

let synchronous_get = function (url) {

    return new Promise(function (resolve, reject) {
        request.get(url, function (error, response, body) {
            if (error) {
                reject(error);
            } else {
                resolve(body);
            }
        });
    });
}


let syncRequest = async function (url) {
    // let url = "http://www.baidu.com/";
    // console.log("syncRequest");
    try {
        let body = await synchronous_get(url);
        return true;
    }catch (e) {
        // console.log(e);
        return false;
    }

}

let checkDataExServer = async function (items) {

    for (let i = 0; i <items.length; i++) {
        var url = 'http://' + items[i].ds_ip + ':' + items[i].ds_port + '/testUpload';
        // var url = 'http://' + items[0].ds_ip + ':' + items[0].ds_port + '/testUpload';
        let isOnline = await syncRequest(url);
        // console.log("checkDataExServer 1");

        // 默认返回第一个能连接通的
        // if (isOnline)
        //     return items[i];

        items[i].ds_status = isOnline;
        DataExServersCtrl.update(items[i], function (err, result) {
            console.log("update " + items[i].ds_ip + ":" + items[i].ds_port + " successfully");
        });



    }
    // console.log("checkDataExServer 2");

}