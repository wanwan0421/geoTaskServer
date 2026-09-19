/**
 * Author: Fengyuan(Franklin) Zhang
 * Date: 2018/12/25 
 * Description: (ho ho ho) Router for server API
 */

var modelServiceSDK = require('modelservicesdk');
var formidable = require('formidable');
var CommonMethod = require('../../utils/commonMethod');
var ServersCtrl = require('../../controls/servers');
var taskCtrl = require('../../controls/task');
var LlmPolicyAdminCtrl = require('../../controls/llmPolicyAdmin');
var Setting = require('../../setting');

function authorizeLlmPolicyAdmin(req, res) {
    var expected = Setting.schedule && Setting.schedule.llmPolicyAdminToken || '';
    var provided = req.get('x-llm-policy-admin-token') || '';
    if (!expected) {
        res.status(503).json({
            result: 'err',
            code: -2,
            message: 'LLM policy admin API is disabled; set LLM_POLICY_ADMIN_TOKEN on the Task Server.',
            data: ''
        });
        return false;
    }
    if (provided !== expected) {
        res.status(401).json({
            result: 'err',
            code: -3,
            message: 'Invalid LLM policy admin token.',
            data: ''
        });
        return false;
    }
    return true;
}

module.exports = function (app) {
    app.route('/server')
        //! 模型服务容器注册路由 by MW
        .post(function (req, res, next) {
            var ip = CommonMethod.getIP(req);
            var mac = 'Unknown';
            try {
                mac = req.body.mac;
            }
            catch (ex) {
                //! TODO Error
            }
            var port = 0;
            try {
                port = parseInt(req.body.port);
            }
            catch (ex) {
                //! TODO Error
            }
            var type = 1;
            try {
                type = parseInt(req.body.type);
            }
            catch (ex) {
                //! TODO Error
            }
	    //! by MW
            var user = req.body.user;
            ServersCtrl.registerByIP(ip, {
                s_mac: mac,
                s_port: port,
                s_type: type,
                s_user: user
            }, function (err, result) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }

                var wasInserted = result && result.lastErrorObject && !result.lastErrorObject.updatedExisting;
                return res.end(JSON.stringify({
                    result: 'suc',
                    code: wasInserted ? 1 : 3,
                    message: wasInserted ? 'Server registered!' : 'Server information has been updated!',
                    data: result && result.value ? result.value._id : ''
                }));
            });
        })
        .get(function (req, res, next) {
            //! get by pid (check is any servers available)
            if (req.query.pid) {
                ServersCtrl.getByPIDWithStatus(req.query.pid, true, function (err, servers) {
                    if (err) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -1,
                            message: err.message,
                            data: ''
                        }));
                    }
                    if (servers.length < 1) {
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 0,
                            message: 'No such server!',
                            data: []
                        }));
                    }
                    return res.end(JSON.stringify({
                        result: 'suc',
                        code: 1,
                        message: '',
                        data: [servers.length]
                    }));
                });
            }
            else if (req.query.ac == 'connect') {
                //connection with service container(initiative request),params is mac
                var mac = req.query.mac;
                ServersCtrl.getStatusByMac(mac, function (err, result) {
                    if (err) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -1,
                            message: err.message,
                            data: ''
                        }));
                    }
                    if (!result) {
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 0,
                            message: 'Such server cannot connect!',
                            data: ''
                        }));
                    } else {
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: ''
                        }));
                    }
                })
            }
            else {
                return res.end(JSON.stringify({
                    result: 'err',
                    code: -99,
                    message: 'Unknown CMD!',
                    data: ''
                }));
            }
        })
        .put(function (req, res, next) {
            var ip = CommonMethod.getIP(req);
            var mac = 'Unknown';
            try {
                mac = req.body.mac;
            }
            catch (ex) {
                console.error("ex:",ex);
            }
	    
	        //! MW change it as model services, I don't know why
            var pids = [];
            var modelsers = [];
            try {
	    	//! by MW
                modelsers = JSON.parse(req.body.modelsers);
                pids = JSON.parse(req.body.pids);
            }
            catch (ex) {
                //! TODO Error
                return res.status(400).json({
                    result: 'err',
                    code: -2,
                    message: '参数解析失败: ' + ex.message,
                    data: ''
                });
            }
            ServersCtrl.postServices(ip, mac, modelsers, function (err, result) {
                if (err) {
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
                    data: ''
                }));
            });
        });

    // 获取到任务服务器下管理的所有模型的详细信息，包含pid, add bu wangming at 2020.04.30(给朱之一新增的接口)
    app.route('/server/modelPid/all')
        .get(function (req, res, next) {
            ServersCtrl.getAllAvailModelServicesPid(function (err, result) {
                if (err) {
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
                    data: result
                }));
            })
        });

    // manager服务器获取最优的服务器列表
    app.route('/server/pickBestServer')
        .get(function (req, res, next) {
            var pid = req.query.pid;
            var inputs = [];
            try {
                inputs = req.query.inputs ? JSON.parse(decodeURIComponent(req.query.inputs)) : [];
            } catch (err) {
                return res.end(JSON.stringify({
                    result: 'err',
                    code: -1,
                    message: 'Invalid inputs JSON: ' + err.message,
                    data: ''
                }));
            }

            ServersCtrl.getServersWithScores(pid, inputs, function (err, scoreResult) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }

                const responseData = {
                    status: scoreResult.status,
                    servers: scoreResult.servers,
                    decisionId: scoreResult.decisionId,
                    decisionMode: scoreResult.decisionMode,
                    fallback: scoreResult.fallback,
                    fallbackReason: scoreResult.fallbackReason,
                    totalInputSize: scoreResult.totalInputSize,
                    inputWarnings: scoreResult.inputWarnings
                };

                return res.end(JSON.stringify({
                    result: 'suc',
                    code: 1,
                    message: '',
                    data: responseData
                }));
            });
        })

    app.route('/server/llm-policy-cache/prewarm')
        .post(function (req, res) {
            if (!authorizeLlmPolicyAdmin(req, res)) {
                return;
            }
            LlmPolicyAdminCtrl.startPrewarm({
                force: !!(req.body && req.body.force === true)
            }, function (err, result) {
                if (err) {
                    return res.status(500).json({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    });
                }
                return res.status(result.started ? 202 : 200).json({
                    result: 'suc',
                    code: 1,
                    message: result.started ? 'LLM policy prewarm started.' : 'LLM policy prewarm is already running.',
                    data: result
                });
            });
        });

    app.route('/server/llm-policy-cache/status')
        .get(function (req, res) {
            if (!authorizeLlmPolicyAdmin(req, res)) {
                return;
            }
            LlmPolicyAdminCtrl.getStatus(function (err, status) {
                if (err) {
                    return res.status(500).json({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    });
                }
                return res.json({
                    result: 'suc',
                    code: 1,
                    message: '',
                    data: status
                });
            });
        });

    app.route('/server/:serverid')
        .get(function (req, res, next) {
            if (req.params.serverid == 'all') {
                //! TODO or Delete
                res.end('children!');
            }
            else if (req.params.serverid == 'status') {
                next();
            }
            else if (req.params.serverid == 'localStatus') {
                next();
            } else if (req.params.serverid == 'check') {
                next();
            }else if(req.params.serverid == 'judgeStatus'){
                next();
            }
            else {
                //! TODO or Delete
                res.end('child! : ' + req.params.serverid);
            }
        });

    // model container unregister route
    app.route('/server/unregister')
        .put(function (req, res, next) {
            var ip = CommonMethod.getIP(req);
            var mac = 'Unknown';
            try {
                mac = req.body.mac;
            } catch (ex) {
                console.log(ex);
            }
            ServersCtrl.getByMac(mac, function (err, server) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                if (server.length > 0) {
                    var server_id = server[0]._id;
                    var user = server[0].s_user;
                    ServersCtrl.delete(server_id, function (err, data) {
                        if (err) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -1,
                                message: err.message,
                                data: ''
                            }));
                        }
                        ServersCtrl.unregisterInfoToManagerServer(mac, user, function (err, result) {
                            if (err) {
                                console.log(err);
                            }
                            if (result) {
                                console.log('unregister success to portal success!');
                            } else {
                                console.log('unregister success to portal fail!');
                            }
                        });

                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: ''
                        }));
                    })
                } else {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'unregister request error, no such register record',
                        data: ''
                    }));
                }
            })
        })


    //! just for type = 1 : local network, 局域网内的任务服务器，可以直接和旗下管理的机器直接通信,废弃
    if (Setting.type == 1) {
        app.route('/server/modelser/all')
            .get(function (req, res, next) {
                ServersCtrl.getAllModelServices(function (err, msc) {
                    if (err) {
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
                        data: msc.getAllModelServices()
                    }));
                });
            });
    }

    // ! get server status and task running size by pid(check this task server whether useful)
    app.route('/server/status')
        .get(function (req, res, next) {
            var pid = req.query.pid;
            ServersCtrl.getServerStatusByPid(pid, function (err, data) {
                if (err) {
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
                    data: data
                }));
            })
        })

    //! The codes below are appended by MW
    //! add by wangming at 2020.05 get the server status, model container mac and task running size by pid
    app.route('/server/judgeStatus/:pid')
        .get(function(req,res,next){
            var pid = req.params.pid;
            ServersCtrl.getAllSuitableServerByPid(pid, function(err, data){
                if (err) {
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
                    data: data
                }));
            })
        })

    //! get the model package and deploy the model package to the model container to publish service
    //TODO 是根据环境匹配后指定的模型容器去部署
    app.route('/server/modelser/deploy')
        .post(function (req, res, next) {
            ServersCtrl.getByTypeWithStatus(1, true, function (err, servers) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                if (servers.length > 0) {
                    //reorder, maybe later consider other algorithm to get suitable container
                    servers = CommonMethod.arrayReorder(servers);
                    var servers_s = servers.splice(0, 1)[0];
                    //request dispatching, upload package
                    ServersCtrl.dispatchRequest(req, servers_s, function (err, data) {
                        if (err) {
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
                            data: data
                        }));
                    })
                } else {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'No Available Model Container to deploy!',
                        data: ''
                    }));
                }
            })

        })

    //! get the server status and task running size by the type that is Local Network(type = 1)
    app.route('/server/localStatus')
        .get(function (req, res, next) {
            ServersCtrl.getLocalServers(function (err, data) {
                if (err) {
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
                    data: data
                }));
            })
        })


    // 新增路由，用于更新公网模型服务容器ip变更的请求 - check?mac=**
    app.route('/server/check')
        .get(function (req, res, next) {
            const ip = CommonMethod.getIP(req);
            const mac = req.query.mac;
            ServersCtrl.checkIP(ip, mac, function (err, result) {
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
                    data: result
                }));
            })
        })

    // Removed by FZ at 2020-6-24, because it is always wrong.
    // // 新增路由，用于更新已注册的模型服务容器的软硬件环境信息
    // app.route('/server/enviro')
    //     .put(function (req, res, next) {
    //         let mac = req.body.mac;
    //         let info = JSON.parse(req.body.info);
    //         ServersCtrl.updateServerEnviroInfo(mac, info, function (err, result) {
    //             if (err) {
    //                 return res.end(JSON.stringify({
    //                     result: 'err',
    //                     code: -1,
    //                     message: err.message,
    //                     data: false
    //                 }));
    //             }
    //             return res.end(JSON.stringify({
    //                 result: 'suc',
    //                 code: 1,
    //                 message: '',
    //                 data: true
    //             }));
    //         });
    //     });

    // 更新已注册的模型服务到数据库中,其服务是绑定了门户的相关计算模型条目信息
    app.route('/server/bind')
        .put(function(req, res, next) {
            let ip = CommonMethod.getIP(req);
            let mac = 'Unknown';
            try {
                mac = req.body.mac;
            }
            catch (ex) {
                //! TODO Error
            }
            let modelser = null;
            try {
                modelser = JSON.parse(req.body.modelser);
            }catch(ex) {
                modelser = req.body.modelser;
            }
            ServersCtrl.bindServices(ip, mac, modelser, function(err, result) {
                if (err) {
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
                    data: result
                }));
            });

        });

    app.route('/server/unbind')
        .put(function(req, res, next) {
            let ip = CommonMethod.getIP(req);
            let mac = 'Unknown';
            try {
                mac = req.body.mac;
            }catch (ex) {
                console.log(ex);
            }
            let modelser = null;
            try {
                modelser = JSON.parse(req.body.modelser);
            }catch(ex) {
                modelser = req.body.modelser;
            }
            if(Array.isArray(modelser)){
                //批量注销多个模型服务
                ServersCtrl.batchUnbindServices(ip, mac, modelser, function(err,result) {
                    if(err) {
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
                        data: result
                    }));
                })
            }else {
                //ע������ģ�ͷ���
                ServersCtrl.unbindService(ip, mac, modelser, function(err, result) {
                    if (err) {
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
                        data: result
                    }));
                })
            }  
        })

    //add by wangming at 2020.05.18 更新动态环境信息到管理服务器(起名字真的烦，就这样随便起吧)
    app.route('/server/updateDynamic')
        .put(function(req, res, next){
            let mac = req.body.mac;
            let dynamic_info = JSON.parse(req.body.dynamicInfo);
            ServersCtrl.updateDynamicInfoToManagerServer(mac, dynamic_info, function(err, result){
                if(err){
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: false
                    }));
                }
                if(result){
                    return res.end(JSON.stringify({
                        result: 'suc',
                        code: 1,
                        message: '',
                        data: true
                    }));
                }else {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: '',
                        data: false
                    }));
                }
            })
        })

    // add by qbin at 2024.03.01 获取部署了指定模型的节点列表
    app.route('/server/modelser/:pid')
        .get(function(req, res, next){
            var pid = req.params.pid;
            ServersCtrl.getByPID(pid, function (err, servers) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }

                var deployedServers = [];

                servers.forEach(function(server){
                    deployedServers.push(server.s_ip);
                })

                return res.end(JSON.stringify({
                    result: 'suc',
                    code: 1,
                    message: '',
                    data: deployedServers
                }));

        })
    })
}
