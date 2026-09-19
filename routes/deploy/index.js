/**
 * Author: Ming Wang
 * Date: 2020.05.22
 * Description: Router for Model Deploy Task
 */
var ServersCtrl = require('../../controls/servers');
var ModelDeployCtrl = require('../../controls/modelDeploy');

module.exports = function (app) {
    app.route('/deploy')
        .post(function (req, res, next) {
            var taskData = req.body;
            var mac = taskData.mac;
            ServersCtrl.getByMac(mac, function (err, servers) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                //判断服务器的状态是否是可用，不可用
                if (servers.length > 0) {
                    var server = servers[0];
                    //判断模型容器是否可用
                    if (server.s_status) {
                        var deployTask = {
                            d_user: taskData.user,
                            d_status: 'Inited',
                            d_start: new Date(),
                            d_mac: mac,
                            d_name: taskData.name,
                            d_pid: taskData.pid,
                            d_type: server.s_type,
                            d_package: taskData.modelPackagePath
                        };
                        //如果taskServer发现这台模型容器上已经存在相同的模型服务了，就不需要在部署了，直接部署任务成功
                        let model_services = server.s_services;
                        let status = false;
                        for (let i = 0; i < model_services.length; i++) {
                            if (model_services[i].pid === taskData.pid) {
                                //说明已经存在啦
                                status = true;
                                break;
                            }
                        }
                        if (!status) {
                            ModelDeployCtrl.add(deployTask, function (err, deployItem) {
                                if (err) {
                                    return res.end(JSON.stringify({
                                        result: 'err',
                                        code: -1,
                                        message: err.message,
                                        data: ''
                                    }));
                                }
                                // organize request parameter
                                var deployInfo = {
                                    taskId: deployItem._id,
                                    userName: taskData.user,
                                    packagePath: taskData.modelPackagePath,
                                    pid: taskData.pid
                                };
                                //在这里，针对type = 1和type = 2的两种计算资源采取不同的措施，类似于模型计算任务的分配
                                if (server.s_type == 1) {
                                    //local network
                                    //! post deploy task
                                    ModelDeployCtrl.sendDeployTask(server, deployInfo, deployItem, function (err, result) {
                                        if (err) {
                                            return res.end(JSON.stringify({
                                                result: 'err',
                                                code: -1,
                                                message: err.message,
                                                data: ''
                                            }));
                                        }
                                        //因为有可能存在模型部署失败的情况，需要进行分情况讨论
                                        return res.end(JSON.stringify({
                                            result: 'suc',
                                            code: 1,
                                            message: '',
                                            data: result
                                        }));
                                    })
                                } else {
                                    let response_data = {
                                        task_id: deployItem._id,
                                        status: 0
                                    };
                                    //Internet 
                                    return res.end(JSON.stringify({
                                        result: 'suc',
                                        code: 1,
                                        message: '',
                                        data: response_data
                                    }));
                                }
                            })
                        } else {
                            deployTask.d_status = 'Finished';
                            deployTask.d_finish = new Date();
                            ModelDeployCtrl.add(deployTask, function (err, deployItem) {
                                if (err) {
                                    return res.end(JSON.stringify({
                                        result: 'err',
                                        code: -1,
                                        message: err.message,
                                        data: ''
                                    }));
                                }
                                let response_data = {
                                    task_id: deployItem._id,
                                    status: 1
                                };
                                return res.end(JSON.stringify({
                                    result: 'suc',
                                    code: 1,
                                    message: '',
                                    data: response_data
                                }));
                            })
                        }

                    } else {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -1,
                            message: 'this computer resource can not be used, please choose other',
                            data: ''
                        }));
                    }
                } else {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'no this computer resource',
                        data: ''
                    }));
                }
            })
        });

    //get the task list which should be deployed(Inited task, only get the d_type = 2)
    app.route('/deploy/inited/all')
        .get(function (req, res, next) {
            var mac = req.query.mac;
            ServersCtrl.getByMac(mac, function (err, servers) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: []
                    }));
                }
                if (servers.length > 0) {
                    //不需要再添加更新服务器状态的相关代码
                    ModelDeployCtrl.getByMacAndInitedStatus(mac, function (err, tasks) {
                        if (err) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -1,
                                message: err.message,
                                data: []
                            }));
                        }
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: tasks
                        }));
                    })
                } else {
                    //Database error, no such record
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Database error, no such record',
                        data: []
                    }));
                }
            });
        });
    app.route('/deploy/:id')
        .put(function(req,res,next){
            var taskId = req.params.id;
            var req_status = req.body.status;
            //根据不同的状态来更新模型部署数据库的内容
            ModelDeployCtrl.updateDeployStatus(req_status, taskId, function(err,result){
                if(err){
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                if(result){
                    return res.end(JSON.stringify({
                        result: 'suc',
                        code: 1,
                        message: '',
                        data: ''
                    }));
                }else {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'update database record error',
                        data: ''
                    }));
                }
            })
        })
        .get(function(req,res,next){
            ModelDeployCtrl.getByOID(req.params.id, function(err, deployTask){
                if(err){
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                return res.end(JSON.stringify({
                    result: 'suc',
                    code: 1,
                    message: '',
                    data: deployTask
                }));
            });
        })
}