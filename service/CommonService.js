/**
 * Author : qingbin
 * Date : 2022/4/29
 * Description : Common service (为了避免同一层级的代码相互引用，将相互调用的方法统一封装到这里)
 */

var TaskModel = require('../models/task');
var ServersModel = require('../models/servers');
var CommonBase = require('../utils/commonBase');

var CommonService = function() {};
CommonService.__proto__ = CommonBase;

module.exports = CommonService;

//! get the number of all the Started status task
CommonService.getByStartedStatus = function(callback){
    TaskModel.getAllByStatus('Started', function(err,tasks){
        if(err){
            return callback(err);
        }
        return callback(null, tasks.length);
    })
}


// get all the Started task by t_server
CommonService.getAllByServerAndStartedStatus = function(server_id,pid,callback){
    TaskModel.getAllByServerAndStatus(server_id,function(err,tasks){
        if(err){
            return callback(err);
        }
        // get the sucessful and failed count by given task
        TaskModel.getAllByServerWithPidAndStatus(server_id,pid,'Finish', function(err, success){
            if(err){
                return callback(null, {
                    task: tasks.length,
                    reliability: 1
                });
            }
            TaskModel.getAllByServerWithPidAndStatus(server_id,pid,'Failed', function(err, fail){
                if(err){
                    return callback(null, {
                        task: tasks.length,
                        reliability: 1
                    });
                }
                var sum = success.length + fail.length;
                if(sum != 0){
                    let reliability = success.length / sum;
                    return callback(null, {
                        task: tasks.length,
                        reliability: reliability
                    });
                }else {
                    return callback(null, {
                        task: tasks.length,
                        reliability: 1
                    });
                }
            })
        })


    })
}


CommonService.getAll = function(callback){
    ServersModel.getAll(this.returnFunction(callback, 'Error in get all server'));
}

//! get server by PID and status is true
CommonService.getByPIDWithStatus = function(pid, status, callback){
    ServersModel.getByPIDWithStatus(pid, status, this.returnFunction(callback, 'Error in getting servers by PID and status'));
}






