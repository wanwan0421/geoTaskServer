/**
 * Author: Ming Wang
 * Date: 2020.05.22
 * Description: Controller for Model Deploy Task
 */
const ControlBase = require('./controlBase');
const DeployModel = require('../models/modelDeploy');
const request = require('request');
const Setting = require('../setting');

var ModelDeployCtrl = function () { };
ModelDeployCtrl.__proto__ = ControlBase;
ModelDeployCtrl.model = DeployModel;

module.exports = ModelDeployCtrl;

//返回结果需要包含task_id和相关的状态信息(返回给门户的状态信息包含 失败(-1) 成功(1))
ModelDeployCtrl.sendDeployTask = function (server, deployInfo, deployItem, callback) {
    let url = 'http://' + server.s_ip + ':' + server.s_port + '/task/modelDeploy';
    request.post(url, { form: deployInfo }, function (err, data) {
        if (err) {
            //说明模型部署任务出错，需要更新数据库
            deployItem.d_status = 'Error';
            deployItem.d_finish = new Date();
            ModelDeployCtrl.update(deployItem, function (err, result) {
                //此处错误需要特定处理
                let response_data = {
                    task_id: deployItem._id,
                    status: -1
                };
                return callback(null, response_data);
            })
        }
        var body = JSON.parse(data.body);
        if (body.result == 'suc') {
            deployItem.d_status = 'Finished';
            deployItem.d_finish = new Date();
            ModelDeployCtrl.update(deployItem, function (err, result) {
                let response_data = {
                    task_id: deployItem._id,
                    status: 1
                };
                return callback(null, response_data);
            })     
        }else {
            //说明模型部署失败
            deployItem.d_status = 'Error';
            deployItem.d_finish = new Date();
            ModelDeployCtrl.update(deployItem,  function(err, result){
                let response_data = {
                    task_id: deployItem._id,
                    status: -1
                };
                return callback(null, response_data);
            })
        }
    })
}

ModelDeployCtrl.getByMacAndInitedStatus = function(mac, callback){
    let d_type = 2;
    DeployModel.getByMacAndStatus(mac, 'Inited', d_type, this.returnFunction(callback, 'Error in getting tasks by server id and inited status'));
}

ModelDeployCtrl.updateDeployStatus = function(status, taskId, callback){
    //首先根据id查询
    DeployModel.getByOID(taskId, function(err, deployItem){
        if(err){
            return callback(err);
        }
        if(status == -1){
            //说明模型部署出错
            deployItem.d_status = 'Error';
        }else {
            deployItem.d_status = 'Finished';
        }
        //需要更新数据库，同时还需要将消息更新到Manager Server
        deployItem.d_finish = new Date();
        ModelDeployCtrl.update(deployItem, function(err, result){
            //向Manager Server发起请求进行记录更新
            let form = {
                taskId: deployItem._id,
                status: status
            }
            let url = 'http://' + Setting.resourceCenter.website + '/modelResource/updateDeployRecord';
            request.post(url, {form: form}, function(err,data){
                if(err){
                    return callback(err);
                }
                let body = JSON.parse(data.body);
                if(body.code != -1){
                    return callback(null, true);
                }else {
                    return callback(null, false);
                }
            })
        })
    })
}