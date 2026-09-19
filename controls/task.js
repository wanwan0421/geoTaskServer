/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2019/1/25
 * Update : 2025/7/17(wanwan)
 * Description : Task control
 */
var ServiceServer = require('modelservicesdk');
var ControlBase = require('./controlBase');
var TaskModel = require('../models/task');
var CommonService = require('../service/CommonService');
var Schedule = require('node-schedule');
var Setting = require('../setting');
var http = require('http');
var https = require('https');
var request = require('request');
var TaskReservationCtrl = require('./taskReservation');
var ScheduleDecisionCtrl = require('./scheduleDecision');

var TaskCtrl = function() {};
TaskCtrl.__proto__ = ControlBase;
TaskCtrl.model = TaskModel;

module.exports = TaskCtrl;

TaskCtrl.init = function () {
    global.taskPolling = [];
}

TaskCtrl.finished = function (params) {
    
}

//! get all the Inited status task by t_server, and the t_type is 2, represent the network environment
TaskCtrl.getByServerAndInitdStatus = function(server_id, callback){
    let t_type = 2;
    TaskModel.baseModel.find({
        t_server: server_id,
        t_status: 'Inited',
        t_type: t_type
    }).sort({ t_datetime: 1, _id: 1 }).exec(this.returnFunction(callback, 'Error in getting tasks by server id and inited status'));
}

//! get the number of all the Started status task
TaskCtrl.getByStartedStatus = function(callback){
    TaskModel.getAllByStatus('Started', function(err,tasks){
        if(err){
            return callback(err);
        }
        return callback(null, tasks.length);
    })
}

TaskCtrl.getRecentByServerWithPidAndStatuses = function (server_id, pid, statuses, limit, callback) {
    var query = {
        t_server: server_id,
        t_pid: pid,
        t_status: { $in: statuses }
    };
    var safeLimit = Math.max(1, Number(limit) || 10);
    TaskModel.baseModel.find(query).sort({ t_endTime: -1, t_datetime: -1 }).limit(safeLimit).lean().exec(function (err, tasks) {
        if (err) {
            console.error('Error getting recent terminal tasks:', err);
            return callback(err);
        }
        return callback(null, tasks || []);
    });
}

TaskCtrl.getRecentFinishedTasks = function (server_id, pid, limit, callback) {
    return TaskCtrl.getRecentByServerWithPidAndStatuses(server_id, pid, ['Finished'], limit, callback);
}

TaskCtrl.getRecentFinishedTasksByPid = function (pid, limit, callback) {
    var safeLimit = Math.max(1, Number(limit) || 10);
    TaskModel.baseModel.find({
        t_pid: pid,
        t_status: 'Finished',
        t_duration: { $gt: 0 }
    }).sort({ t_endTime: -1, t_datetime: -1 }).limit(safeLimit).lean().exec(function (err, tasks) {
        return callback(err, tasks || []);
    });
}

// Return same-server Finished tasks within the 0.5-2.0 input-size ratio,
// ordered by logarithmic input-size distance before applying the limit.
TaskCtrl.getNearestFinishedTasksByInputSize = function (options, callback) {
    options = options || {};
    var safeLimit = Math.max(1, Math.floor(Number(options.limit) || 10));
    var targetInputSize = Math.max(0, Number(options.currentInputSize) || 0);
    var query = {
        t_pid: options.pid,
        t_status: 'Finished',
        t_duration: { $gt: 0 }
    };
    var minimumRatio = Number.isFinite(Number(options.minimumRatio)) ? Number(options.minimumRatio) : 0.5;
    var maximumRatio = Number.isFinite(Number(options.maximumRatio)) ? Number(options.maximumRatio) : 2;
    var sizeQuery = {
        $gte: Math.max(0, targetInputSize * minimumRatio),
        $lte: Math.max(0, targetInputSize * maximumRatio)
    };
    query.t_totalInputSize = sizeQuery;

    if (options.serverId !== undefined && options.serverId !== null) {
        query.t_server = options.serverId;
    } else if (options.excludeServerId !== undefined && options.excludeServerId !== null) {
        query.t_server = { $ne: options.excludeServerId };
    }

    TaskModel.baseModel.aggregate([
        { $match: query },
        {
            $addFields: {
                __inputSizeLogDistance: {
                    $abs: {
                        $subtract: [
                            { $ln: { $add: ['$t_totalInputSize', 1] } },
                            Math.log1p(targetInputSize)
                        ]
                    }
                }
            }
        },
        { $sort: { __inputSizeLogDistance: 1, t_endTime: -1, t_datetime: -1, _id: -1 } },
        { $limit: safeLimit },
        { $project: { __inputSizeLogDistance: 0 } }
    ]).exec(function (err, tasks) {
        if (err) {
            console.error('Error getting nearest Finished tasks by input size:', err);
            return callback(err);
        }
        return callback(null, tasks || []);
    });
}

// get all the Started task by t_server
TaskCtrl.getAllByServerAndStartedStatus = function(server_id,pid,callback){
    TaskModel.getAllByServerAndStatus(server_id,function(err,tasks){
        if(err){
            return callback(err);
        }
        // get the sucessful and failed count by given task
        TaskModel.getAllByServerWithPidAndStatus(server_id,pid,'Finished', function(err, success){
            if(err){
                return callback(null, {
                    task: tasks.length,
                    reliability: 1
                });
            }
            TaskModel.getAllByServerWithPidAndStatus(server_id,pid,'Error', function(err, fail){
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

//! get all waiting tasks
TaskCtrl.getAllInitedTasks = function(callback){
    TaskModel.getAllByStatus('Inited', this.returnFunction(callback, 'Error in getting all inited tasks'));
}

//! rescheduling for the task
TaskCtrl.rescheduling = function(){
    var rule = new Schedule.RecurrenceRule();
    // rule.minute = [0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58];
    rule.minute = [0];
    Schedule.scheduleJob(rule, ()=>{
        //! reschedule the tasks (by 7bin)
        TaskCtrl.reschedulingFunction2();

    });
}

// 任务重分配代码块 思路1: 查task表Finished任务的server(写到一半感觉这种思路不对,做了测试没有重新分配的任务)
/*TaskCtrl.reschedulingFunction1 = function (){

    // 查Task表，运行时间大于两小时的就重分配
    TaskModel.getAllInitedAndStartedTasks((err, docs) => {
        let tasksByStatus = docs;
        if (err){
            console.log("getAllInitedAndStartedTasks error:" + err.message);
            return;
        }
        let count = 0;
        // 找到这个任务的PID
        for (let task of tasksByStatus) {
            console.log(++count);
            let pendingPid = task.t_pid;
            // let pendingPid = "069e1d69934bdf131cc5b38825c7990d";
            // 遍历Task表中 t_pid = pendingPid 并且 t_status = Finished 的记录并返回

            TaskModel.getAllFinishedTasksByPid(pendingPid,async (err, docs) => {
                if (err){
                    console.log("getAllFinishedTasksByPid error:" + err.message);
                    return;
                }


                // 在task表中没找到返回error
                if (docs.length === 0) {
                    console.log("we don't find any eligible task --- taskId:" + task._id);
                    return;
                }


                //得到该模型跑成功的服务器
                let eligibleTask = docs;
                let serverArr = [];
                for (let t of eligibleTask) {
                    serverArr.push(t.t_server);
                }
                // 把重复的服务器过滤掉
                serverArr = Array.from(new Set(serverArr));
                let available = [];  //可分配的服务器

                // 把异步请求封装起来
                // 获得所有模型容器服务器
                let allServers = await new Promise((resolve, reject) => {
                    // ServerCtrl.getAll((err,res) => {
                    CommonService.getAll((err,res) => {
                        if(err)
                            resolve([]);
                        if (res){
                            resolve(res);
                        }
                    })
                })
                allServers.map((value, index) => {
                    allServers[index] = value._id;
                });
                allServers = [];

                // 过滤掉未注册的服务器(该服务器是否还在数据库中)
                for (let s of serverArr) {
                    if (allServers.indexOf(s) >= 0){
                        available.push(s);
                    }
                }

                //如果没有符合条件的服务器返回错误信息
                if (available.length === 0) {
                    console.log("we don't find any available mac to run this model --- taskId:" + task._id);
                    return;
                }

                // 把任务放到符合条件的服务器上，update t_server
                // 分配策略: 随机分配(random)
                let selectedServer = available[Math.round(Math.random()*(available.length - 1))];
                task.t_server = selectedServer;
                task.t_status = "Inited";
                task.t_slotGrantedTime = new Date();
                TaskCtrl.update(task, function (err, result) {
                    if (err) {
                        console.log("update task error:" + err.message);
                        return;
                    }
                    console.log("update success rescheduling task:" + task._id + " ---- server:" + selectedServer);
                });
            });
        }
    });

}*/


// 任务重分配代码块 思路2: 查server表进行分配（started才重分配，inited就kill）
TaskCtrl.reschedulingFunction2 = function (){

    console.log("task rescheduling...");

    // 查Task表，运行时间大于两小时的就重分配
    TaskModel.getAllInitedAndStartedTasks((err, docs) => {
        if (err){
            console.log("getAllInitedAndStartedTasks error:" + err.message);
            return;
        }

        // 筛选出运行时间大于两小时的任务
        let tasksByStatus = docs;
        let currentDate = new Date();
        var tasks = [];
        for (let task of tasksByStatus) {
            var timeBasis = task.t_status === 'Started'
                ? (task.t_startTime || task.t_datetime)
                : (task.t_enqueuedTime || task.t_datetime);
            var time = new Date(timeBasis);
            var temp = (currentDate - time) / 1000 / 60;
            if (temp > (2 * 60) )
                tasks.push(task);
        }


        // let count = 0;
        // 找到这个任务的PID
        for (let task of tasks) {

            if (task.t_status == "Inited"){
                changeTaskStatus2Error(task,"kill this task because of 'inited' too long --- taskId:" + task._id);
                continue;
            }


            let pendingPid = task.t_pid;
            // let pendingPid = "069e1d69934bdf131cc5b38825c7990d";
            // 遍历Server表中pid是task的pid且服务器在线的记录
            // ServerCtrl.getByPIDWithStatus(pendingPid, true, (err, docs) => {
            CommonService.getByPIDWithStatus(pendingPid, true, (err, docs) => {
                if (err){
                    console.log("getByPIDWithStatus error:" + err.message);
                    return;
                }

                // 在server表中没找到返回error
                if (docs.length === 0) {
                    // console.log("we don't find any eligible server --- taskId:" + task._id);
                    changeTaskStatus2Error(task,"we don't find any eligible server --- taskId:" + task._id);
                    return;
                }

                // console.log(++count);

                let eligibleServer = docs;
                let serverArr = [];
                for (let s of eligibleServer) {
                    serverArr.push(s._id);
                }

                // 把任务放到符合条件的服务器上，update t_server
                // 分配策略: 随机分配(random)
                let selectedServer = serverArr[Math.round(Math.random()*(serverArr.length - 1))];
                task.t_server = selectedServer;
                task.t_status = "Inited";
                task.t_slotGrantedTime = new Date();
                TaskCtrl.update(task, function (err, result) {
                    if (err) {
                        console.log("update task error:" + err.message);
                        return;
                    }
                    console.log("update success rescheduling task:" + task._id + " ---- server:" + selectedServer);
                });



            });

            // break;
        }
    });
}

// 更新任务状态
TaskCtrl.updateRunTask = function (taskid, status) {
    //主动请求manager server的更新任务状态接口 更新manager server task表的状态
    var url = "http://" + Setting.manager.website + "/GeoModeling/task/updateRunTask/" + taskid + "?status=" + status;
    request.get(url, function (err, data) {
        if (err) {
            console.log("update manager server runTask status error");
            return;
        }
        // {"code":1,"msg":"suc","data":null}
        console.log("update manager server runTask status successfully");
    });
}

// 获取输入数据大小
TaskCtrl.parseJsonField = function (value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (err) {
            console.error('JSON parse failed:', err.message);
            return defaultValue;
        }
    }
    return value;
}

TaskCtrl.getScheduleConfig = function () {
    return Setting.schedule || {};
}

TaskCtrl.getInputUrl = function (input) {
    if (!input) {
        return '';
    }
    return input.Url || '';
}

TaskCtrl.normalizeInputs = function (inputs) {
    var parsedInputs = TaskCtrl.parseJsonField(inputs, []);
    if (!Array.isArray(parsedInputs)) {
        return [];
    }
    return parsedInputs.map(function (input) {
        var item = Object.assign({}, input);
        return item;
    });
}

// Read optional byte-size metadata supplied by the experiment client or data
// server. `sizeBytes` is canonical; `size` is kept for compatibility with
// inputs that TaskServer enriched previously.
TaskCtrl.getProvidedInputSize = function (input) {
    if (!input || typeof input !== 'object') {
        return { present: false };
    }

    var field = null;
    if (Object.prototype.hasOwnProperty.call(input, 'sizeBytes')) {
        field = 'sizeBytes';
    } else if (Object.prototype.hasOwnProperty.call(input, 'size')) {
        field = 'size';
    }

    if (!field) {
        return { present: false };
    }

    var rawValue = input[field];
    var parsedValue = NaN;
    if (typeof rawValue === 'number') {
        parsedValue = rawValue;
    } else if (typeof rawValue === 'string' && rawValue.trim() !== '') {
        parsedValue = Number(rawValue);
    }

    if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
        return {
            present: true,
            valid: false,
            field: field
        };
    }

    return {
        present: true,
        valid: true,
        field: field,
        value: parsedValue
    };
}

// 计算输入数据总大小，并在回调中返回规范化的输入数据、总大小和警告信息
TaskCtrl.validateInputUrls = function (inputs) {
    if (!Array.isArray(inputs)) {
        return new Error('inputs must be an array');
    }

    for (var i = 0; i < inputs.length; i++) {
        var input = inputs[i] || {};
        if (Object.prototype.hasOwnProperty.call(input, 'url') || Object.prototype.hasOwnProperty.call(input, 'URL')) {
            return new Error('Invalid input URL field at inputs[' + i + ']. Use "Url" only.');
        }
        if (!Object.prototype.hasOwnProperty.call(input, 'Url') || input.Url === undefined || input.Url === null || input.Url === '') {
            return new Error('Missing required input Url at inputs[' + i + ']');
        }
        if (typeof input.Url !== 'string') {
            return new Error('Invalid input Url at inputs[' + i + ']. Url must be a string.');
        }
    }

    return null;
}

TaskCtrl.enrichInputsWithSize = function (inputs, callback) {
    var normalizedInputs = TaskCtrl.normalizeInputs(inputs);
    var warnings = [];
    var totalInputSize = 0;
    var validationError = TaskCtrl.validateInputUrls(normalizedInputs);

    if (validationError) {
        return callback(validationError);
    }

    if (normalizedInputs.length === 0) {
        return callback(null, {
            inputs: normalizedInputs,
            totalInputSize: 0,
            warnings: warnings
        });
    }

    var processedCount = 0;
    var finishOne = function () {
        processedCount++;
        if (processedCount === normalizedInputs.length) {
            return callback(null, {
                inputs: normalizedInputs,
                totalInputSize: totalInputSize,
                warnings: warnings
            });
        }
    };

    normalizedInputs.forEach(function (input) {
        var url = TaskCtrl.getInputUrl(input);
        var providedSize = TaskCtrl.getProvidedInputSize(input);

        if (providedSize.valid) {
            input.sizeBytes = providedSize.value;
            input.size = providedSize.value;
            totalInputSize += providedSize.value;
            finishOne();
            return;
        }

        if (providedSize.present) {
            warnings.push({
                url: url,
                message: 'Invalid ' + providedSize.field + '; falling back to HTTP HEAD'
            });
        }

        TaskCtrl.getFileSize(url, function (err, size) {
            if (err) {
                warnings.push({
                    url: url,
                    message: err.message
                });
                input.size = 0;
                input.sizeBytes = null;
            } else {
                input.size = size || 0;
                input.sizeBytes = input.size;
                totalInputSize += input.size;
            }
            finishOne();
        });
    });
}

TaskCtrl.getFileSize = function(url, callback) {
    var timeoutMs = TaskCtrl.getScheduleConfig().fileSizeTimeoutMs || 5000;
    var settled = false;
    var parseUrl;

    var done = function (err, size) {
        if (settled) {
            return;
        }
        settled = true;
        return callback(err, size || 0);
    };

    try {
        parseUrl = new URL(url);
    } catch (err) {
        return done(err, 0);
    }

    if (parseUrl.protocol !== 'http:' && parseUrl.protocol !== 'https:') {
        return done(new Error('Unsupported input URL protocol: ' + parseUrl.protocol), 0);
    }

    var requestModule = parseUrl.protocol === 'http:' ? http : https;
    var options = {
        hostname: parseUrl.hostname,
        path: parseUrl.pathname + parseUrl.search,
        method: 'HEAD',
        port: parseUrl.port || (parseUrl.protocol === 'http:' ? 80 : 443),
        rejectUnauthorized: false
    };

    var req = requestModule.request(options, function (res) {
        var contentLength = res.headers['content-length'];
        res.resume();

        if (contentLength) {
            return done(null, parseInt(contentLength, 10));
        }
        return done(new Error('No content-length header'), 0);
    });

    req.setTimeout(timeoutMs, function () {
        req.destroy(new Error('HEAD request timeout after ' + timeoutMs + 'ms'));
    });

    req.on('error', function (err) {
        console.error('HEAD request failed ' + url + ':', err.message);
        return done(err, 0);
    });

    req.end();
};

TaskCtrl.buildTaskPayload = function (taskData) {
    var payload = Object.assign({}, taskData || {});
    payload.inputs = TaskCtrl.normalizeInputs(payload.inputs);
    payload.outputs = TaskCtrl.parseJsonField(payload.outputs, []);
    if (!Array.isArray(payload.outputs)) {
        payload.outputs = [];
    }
    return payload;
}

TaskCtrl.getStatusCode = function (status) {
    if (status === 'Inited') {
        return 0;
    }
    if (status === 'Started') {
        return 1;
    }
    if (status === 'Finished') {
        return 2;
    }
    if (status === 'Error') {
        return -1;
    }
    return null;
}

TaskCtrl.normalizeOutputForClient = function (output) {
    var item = Object.assign({}, output || {});
    if (item.url === undefined && item.Url !== undefined) {
        item.url = item.Url;
    }
    if (item.Url === undefined && item.url !== undefined) {
        item.Url = item.url;
    }
    if (item.statename === undefined && item.StateName !== undefined) {
        item.statename = item.StateName;
    }
    if (item.StateName === undefined && item.statename !== undefined) {
        item.StateName = item.statename;
    }
    if (item.event === undefined && item.Event !== undefined) {
        item.event = item.Event;
    }
    if (item.Event === undefined && item.event !== undefined) {
        item.Event = item.event;
    }
    if (item.suffix === undefined && item.Suffix !== undefined) {
        item.suffix = item.Suffix;
    }
    if (item.Suffix === undefined && item.suffix !== undefined) {
        item.Suffix = item.suffix;
    }
    return item;
}

TaskCtrl.calculateActualTimingMetrics = function (task) {
    var toMs = function (value) {
        var parsed = value ? new Date(value).getTime() : NaN;
        return Number.isFinite(parsed) ? parsed : null;
    };
    var enqueuedAtMs = toMs(task && task.t_enqueuedTime);
    var slotGrantedAtMs = toMs(task && task.t_slotGrantedTime);
    var startedAtMs = toMs(task && task.t_startTime);
    var endedAtMs = toMs(task && task.t_endTime);
    var difference = function (later, earlier) {
        return later !== null && earlier !== null && later >= earlier ? later - earlier : null;
    };
    return {
        actualQueueWaitMs: difference(slotGrantedAtMs, enqueuedAtMs),
        actualStartupDelayMs: difference(startedAtMs, slotGrantedAtMs),
        actualServiceTimeMs: difference(endedAtMs, startedAtMs),
        actualCompletionMs: difference(endedAtMs, enqueuedAtMs)
    };
}

TaskCtrl.buildStatusPayload = function (task) {
    var data = JSON.parse(JSON.stringify(task || {}));
    var outputs = Array.isArray(data.t_outputs) ? data.t_outputs.map(TaskCtrl.normalizeOutputForClient) : [];
    data.taskId = data._id ? String(data._id) : '';
    data.pid = data.t_pid || '';
    data.status = data.t_status || '';
    data.statusCode = TaskCtrl.getStatusCode(data.t_status);
    data.finished = data.t_status === 'Finished' || data.t_status === 'Error';
    data.success = data.t_status === 'Finished';
    data.outputs = outputs;
    data.inputs = Array.isArray(data.t_inputs) ? data.t_inputs : [];
    data.startTime = data.t_startTime || null;
    data.endTime = data.t_endTime || null;
    data.enqueuedTime = data.t_enqueuedTime || null;
    data.slotGrantedTime = data.t_slotGrantedTime || null;
    data.duration = data.t_duration !== undefined ? data.t_duration : null;
    var timing = TaskCtrl.calculateActualTimingMetrics(data);
    data.actualQueueWaitMs = timing.actualQueueWaitMs;
    data.actualStartupDelayMs = timing.actualStartupDelayMs;
    data.actualServiceTimeMs = timing.actualServiceTimeMs;
    data.actualCompletionMs = timing.actualCompletionMs;
    data.decisionId = data.t_decisionId || '';
    data.selectedServerId = data.t_server || '';
    data.reservationId = data.t_reservationId || '';
    return data;
}

// 创建一个简化的错误信息摘要，供Worker使用
TaskCtrl.buildWorkerErrorNote = function (body) {
    if (!body) {
        return '';
    }
    var fields = ['status', 'mac', 'msrid', 'error', 'err', 'reason', 'exception', 'message', 'note', 't_note'];
    var summary = {};
    fields.forEach(function (field) {
        if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
            summary[field] = body[field];
        }
    });
    if (body.m_logs) {
        var logs = Array.isArray(body.m_logs) ? body.m_logs.join('\n') : String(body.m_logs);
        summary.m_logs = logs.slice(0, 1000);
    }
    if (body.msr_logs) {
        var msrLogs = Array.isArray(body.msr_logs) ? JSON.stringify(body.msr_logs) : String(body.msr_logs);
        summary.msr_logs = msrLogs.slice(0, 1000);
    }
    if (Object.keys(summary).length === 0) {
        return '';
    }
    try {
        return 'Worker reported Error: ' + JSON.stringify(summary);
    } catch (err) {
        return 'Worker reported Error';
    }
}

TaskCtrl.normalizeTaskForWorker = function (task) {
    var item = JSON.parse(JSON.stringify(task || {}));
    item.t_mspid = item.t_pid || '';
    return item;
}

TaskCtrl.buildWorkerTaskList = function (tasks, count) {
    return (tasks || []).slice(0, count).map(TaskCtrl.normalizeTaskForWorker);
}

TaskCtrl.buildWorkerTaskResponse = function (tasks, count) {
    return {
        result: 'suc',
        code: 1,
        message: '',
        data: TaskCtrl.buildWorkerTaskList(tasks, count)
    };
}

TaskCtrl.markTerminal = function (taskItem, status, note) {
    if (!taskItem) {
        return;
    }

    if (taskItem.t_reservationId) {
        TaskReservationCtrl.release(taskItem.t_reservationId, function (releaseErr) {
            if (releaseErr) {
                console.error('Release reservation failed for task ' + taskItem._id + ':', releaseErr.message);
            }
        });
    } else if (taskItem._id) {
        TaskReservationCtrl.releaseByTask(taskItem._id, function (releaseErr) {
            if (releaseErr) {
                console.error('Release reservation by task failed for task ' + taskItem._id + ':', releaseErr.message);
            }
        });
    }

    var updateDecision = function (decision) {
        var actualDuration = taskItem.t_duration !== undefined && taskItem.t_duration !== null ? Number(taskItem.t_duration) : null;
        var timing = TaskCtrl.calculateActualTimingMetrics(taskItem);
        if (!Number.isFinite(actualDuration) && Number.isFinite(timing.actualServiceTimeMs)) {
            actualDuration = timing.actualServiceTimeMs;
        }
        var predictedDuration = decision && decision.selectedPredictedDuration !== undefined && decision.selectedPredictedDuration !== null ? Number(decision.selectedPredictedDuration) : null;
        var predictionError = null;
        var absoluteError = null;
        var squaredError = null;
        var absolutePercentageError = null;
        var overheadRatio = null;
        var estimatedQueueWaitMs = decision && decision.selectedEstimatedQueueWaitMs !== undefined &&
            decision.selectedEstimatedQueueWaitMs !== null ? Number(decision.selectedEstimatedQueueWaitMs) : null;
        var queueWaitPredictionError = null;
        var queueWaitAbsoluteError = null;
        var queueWaitAbsolutePercentageError = null;

        if (Number.isFinite(actualDuration) && Number.isFinite(predictedDuration)) {
            predictionError = predictedDuration - actualDuration;
            absoluteError = Math.abs(predictionError);
            squaredError = predictionError * predictionError;
            if (actualDuration > 0) {
                absolutePercentageError = absoluteError / actualDuration;
            }
        }
        if (Number.isFinite(actualDuration) && actualDuration > 0 && decision && Number.isFinite(Number(decision.totalScheduleMs))) {
            overheadRatio = Number(decision.totalScheduleMs) / actualDuration;
        }
        if (Number.isFinite(estimatedQueueWaitMs) && Number.isFinite(timing.actualQueueWaitMs)) {
            queueWaitPredictionError = estimatedQueueWaitMs - timing.actualQueueWaitMs;
            queueWaitAbsoluteError = Math.abs(queueWaitPredictionError);
            if (timing.actualQueueWaitMs > 0) {
                queueWaitAbsolutePercentageError = queueWaitAbsoluteError / timing.actualQueueWaitMs;
            }
        }

        var patch = {
            status: status === 'Finished' ? 'finished' : 'error',
            actualTaskStatus: status,
            success: status === 'Finished',
            actualStartTime: taskItem.t_startTime || null,
            actualEndTime: taskItem.t_endTime || null,
            actualDuration: actualDuration,
            actualQueueWaitMs: timing.actualQueueWaitMs,
            actualStartupDelayMs: timing.actualStartupDelayMs,
            actualServiceTimeMs: timing.actualServiceTimeMs,
            actualCompletionMs: timing.actualCompletionMs,
            queueWaitPredictionError: queueWaitPredictionError,
            queueWaitAbsoluteError: queueWaitAbsoluteError,
            queueWaitAbsolutePercentageError: queueWaitAbsolutePercentageError,
            selectedActualDuration: actualDuration,
            selectedPredictedDuration: predictedDuration,
            predictionError: predictionError,
            absoluteError: absoluteError,
            squaredError: squaredError,
            absolutePercentageError: absolutePercentageError,
            biasError: predictionError,
            overheadRatio: overheadRatio,
            fallbackSuccess: decision && decision.fallback ? status === 'Finished' : null,
            errorMessage: note || taskItem.t_note || ''
        };
        if (decision && decision.decisionTrace) {
            var terminalTrace = typeof decision.decisionTrace.toObject === 'function'
                ? decision.decisionTrace.toObject()
                : Object.assign({}, decision.decisionTrace);
            terminalTrace.outcome = Object.assign({}, terminalTrace.outcome || {}, {
                taskSucceeded: status === 'Finished',
                taskStatus: status,
                actualQueueWaitMs: timing.actualQueueWaitMs,
                actualStartupDelayMs: timing.actualStartupDelayMs,
                actualServiceTimeMs: timing.actualServiceTimeMs,
                actualCompletionMs: timing.actualCompletionMs,
                estimatedQueueWaitMs: estimatedQueueWaitMs,
                queueWaitPredictionError: queueWaitPredictionError,
                queueWaitAbsoluteError: queueWaitAbsoluteError,
                queueWaitAbsolutePercentageError: queueWaitAbsolutePercentageError
            });
            patch.decisionTrace = terminalTrace;
        }

        var done = function (logErr) {
            if (logErr) {
                console.error('Update schedule decision terminal status failed for task ' + taskItem._id + ':', logErr);
            }
        };

        if (taskItem.t_decisionId) {
            return ScheduleDecisionCtrl.upsertByDecisionId(taskItem.t_decisionId, patch, done);
        }
        if (taskItem._id) {
            return ScheduleDecisionCtrl.updateByTaskId(taskItem._id, patch, done);
        }
    };

    var handleDecision = function (decisionErr, decision) {
        if (decisionErr) {
            console.error('Get schedule decision by task failed for task ' + taskItem._id + ':', decisionErr);
        }
        if (taskItem.t_decisionId || decision) {
            updateDecision(decision || null);
        }
        if (status === 'Error' && decision) {
            TaskCtrl.retryOursTask(taskItem, decision, note || taskItem.t_note || '');
        }
    };

    ScheduleDecisionCtrl.getByTaskId(taskItem._id, function (decisionErr, decision) {
        if (decision || !taskItem.t_decisionId) {
            return handleDecision(decisionErr, decision);
        }
        ScheduleDecisionCtrl.getByDecisionId(taskItem.t_decisionId, handleDecision);
    });
}

TaskCtrl.startLocalTaskPolling = function (taskItem, tdata) {
    var server = new ServiceServer(tdata.server.s_ip, tdata.server.s_port);
    var access = server.getServiceAccess();
    access.getModelServiceRecordByID(tdata.msrid)
        .then(function (record) {
            if (!record) {
                console.error("Error: Record not found for msrid:", tdata.msrid);
                return;
            }

            var taskPolling = setInterval(function () {
                record.refresh()
                    .then(function () {
                        var status = record.getStatus();

                        if (status == 1) {
                            taskItem.t_status = 'Finished';
                            taskItem.t_endTime = new Date();
                            if (taskItem.t_startTime) {
                                taskItem.t_duration = new Date(taskItem.t_endTime) - new Date(taskItem.t_startTime);
                            }
                            TaskCtrl.update(taskItem, function () {});
                            TaskCtrl.markTerminal(taskItem, 'Finished');
                            clearInterval(taskPolling);
                        }
                        else if (status == -1) {
                            taskItem.t_status = 'Error';
                            taskItem.t_endTime = new Date();
                            if (taskItem.t_startTime) {
                                taskItem.t_duration = new Date(taskItem.t_endTime) - new Date(taskItem.t_startTime);
                            }
                            TaskCtrl.update(taskItem, function () {});
                            TaskCtrl.markTerminal(taskItem, 'Error');
                            clearInterval(taskPolling);
                        }
                    })
                    .catch(function (err) {
                        console.error('Task polling failed:', err.message);
                    });
            }, 30000);

            global.taskPolling.push({
                taskid: String(taskItem._id),
                polling: taskPolling
            });
        })
        .catch(function (err) {
            console.error('Start local task polling failed:', err.message);
        });
}

// 创建并分发任务
TaskCtrl.getOursRetryConfig = function () {
    var schedule = Setting.schedule || {};
    return {
        enabled: schedule.oursRetryEnabled !== false,
        maxAttempts: Math.max(0, parseInt(schedule.oursMaxRetryAttempts || 1, 10)),
        delayMs: Math.max(0, parseInt(schedule.oursRetryDelayMs || 0, 10))
    };
}

TaskCtrl.getUpdateMatchedCount = function (result) {
    if (!result) {
        return 0;
    }
    if (Number.isFinite(Number(result.modifiedCount))) {
        return Number(result.modifiedCount);
    }
    if (Number.isFinite(Number(result.nModified))) {
        return Number(result.nModified);
    }
    if (Number.isFinite(Number(result.n))) {
        return Number(result.n);
    }
    return 0;
}

TaskCtrl.getRetryExcludedServerMap = function (taskItem, decision) {
    var excluded = {};
    if (taskItem && taskItem.t_server) {
        excluded[String(taskItem.t_server)] = true;
    }
    if (decision && decision.selectedServerId) {
        excluded[String(decision.selectedServerId)] = true;
    }
    ((decision && decision.retryAttempts) || []).forEach(function (attempt) {
        if (attempt && attempt.serverId && attempt.stage !== 'reservation_failed') {
            excluded[String(attempt.serverId)] = true;
        }
    });
    return excluded;
}

TaskCtrl.dispatchExistingTask = function (taskItem, selectedServer, options, callback) {
    options = options || {};
    taskItem.t_msrid = '';
    taskItem.t_server = selectedServer._id;
    taskItem.t_status = 'Inited';
    taskItem.t_note = options.note || '';
    taskItem.t_enqueuedTime = taskItem.t_enqueuedTime || options.enqueuedTime || new Date();
    taskItem.t_slotGrantedTime = options.slotGrantedTime || new Date();
    taskItem.t_startTime = null;
    taskItem.t_endTime = null;
    taskItem.t_duration = null;
    taskItem.t_reservationId = options.reservationId || '';

    TaskCtrl.update(taskItem, function (updateErr) {
        if (updateErr) {
            return callback(updateErr, taskItem);
        }

        var taskinfo = {
            "pid": taskItem.t_pid,
            "taskid": taskItem._id,
            "inputs": JSON.stringify(taskItem.t_inputs || []),
            "username": taskItem.t_user,
            "ipport": selectedServer.s_ip + ':' + selectedServer.s_port,
            "outputs": JSON.stringify(taskItem.t_outputs || [])
        };

        if (selectedServer.s_type != 1) {
            ScheduleDecisionCtrl.finishRetry(options.decisionId, {
                status: 'retry_task_created',
                taskId: String(taskItem._id),
                finalTaskId: String(taskItem._id),
                selectedServerId: String(selectedServer._id),
                selectedScore: options.selectedScore,
                selectedPredictedDuration: options.selectedPredictedDuration,
                selectedRawPredictedDuration: options.selectedRawPredictedDuration,
                selectedCalibratedPredictedDuration: options.selectedPredictedDuration,
                predictionCalibrationFactor: options.predictionCalibrationFactor,
                predictionCalibrationSampleCount: options.predictionCalibrationSampleCount,
                selectedEstimatedStartupDelayMs: options.selectedEstimatedStartupDelayMs,
                selectedEstimatedQueueWaitMs: options.selectedEstimatedQueueWaitMs,
                selectedEstimatedWaitMs: options.selectedEstimatedWaitMs,
                selectedEstimatedCompletionMs: options.selectedEstimatedCompletionMs,
                predictionConfidence: options.predictionConfidence || '',
                predictionEvidenceSource: options.predictionEvidenceSource || '',
                reservationId: options.reservationId || '',
                actualTaskStatus: taskItem.t_status || ''
            }, function () {});
            return callback(null, taskItem, selectedServer);
        }

        var ServersCtrl = require('./servers');
        ServersCtrl.sendTask(selectedServer, taskinfo, [], function (sendErr, tdata) {
            if (sendErr) {
                taskItem.t_status = 'Error';
                taskItem.t_note = sendErr.message;
                taskItem.t_endTime = new Date();
                TaskCtrl.update(taskItem, function () {});
                TaskCtrl.markTerminal(taskItem, 'Error', sendErr.message);
                return callback(sendErr, taskItem);
            }

            taskItem.t_server = tdata.server._id;
            taskItem.t_msrid = tdata.msrid;
            taskItem.t_status = 'Started';
            taskItem.t_startTime = new Date();
            taskItem.t_endTime = null;
            taskItem.t_duration = null;

            TaskCtrl.update(taskItem, function (startedErr) {
                if (startedErr) {
                    return callback(startedErr, taskItem);
                }

                ScheduleDecisionCtrl.finishRetry(options.decisionId, {
                    status: 'retry_started',
                    taskId: String(taskItem._id),
                    finalTaskId: String(taskItem._id),
                    actualTaskStatus: 'Started',
                    actualStartTime: taskItem.t_startTime || null,
                    selectedServerId: String(tdata.server._id),
                    selectedScore: options.selectedScore,
                    selectedPredictedDuration: options.selectedPredictedDuration,
                    selectedRawPredictedDuration: options.selectedRawPredictedDuration,
                    selectedCalibratedPredictedDuration: options.selectedPredictedDuration,
                    predictionCalibrationFactor: options.predictionCalibrationFactor,
                    predictionCalibrationSampleCount: options.predictionCalibrationSampleCount,
                    selectedEstimatedStartupDelayMs: options.selectedEstimatedStartupDelayMs,
                    selectedEstimatedQueueWaitMs: options.selectedEstimatedQueueWaitMs,
                    selectedEstimatedWaitMs: options.selectedEstimatedWaitMs,
                    selectedEstimatedCompletionMs: options.selectedEstimatedCompletionMs,
                    reservationId: options.reservationId || ''
                }, function () {});

                TaskCtrl.startLocalTaskPolling(taskItem, tdata);
                return callback(null, taskItem, tdata.server);
            });
        });
    });
}

// 重跑任务
TaskCtrl.retryOursTask = function (taskItem, decision, note) {
    if (!taskItem || !decision || decision.schedulePolicy !== 'OURS_LLM') {
        return;
    }

    var retryConfig = TaskCtrl.getOursRetryConfig();
    if (!retryConfig.enabled || retryConfig.maxAttempts <= 0) {
        return;
    }

    var currentRetryCount = Number(decision.retryCount || 0);
    if (currentRetryCount >= retryConfig.maxAttempts) {
        return;
    }

    var decisionId = decision.decisionId || taskItem.t_decisionId;
    if (!decisionId) {
        return;
    }

    var nextRetryAttempt = currentRetryCount + 1;
    var triggerReason = note || taskItem.t_note || 'Task ended with Error';
    var failedServerId = String(taskItem.t_server || decision.selectedServerId || '');
    var excludedServerMap = TaskCtrl.getRetryExcludedServerMap(taskItem, decision);
    var reservationEnabled = decision.reservationEnabled !== false;

    ScheduleDecisionCtrl.claimRetry(decisionId, currentRetryCount, {
        status: 'retry_scheduling',
        retryEnabled: true,
        maxRetryAttempts: retryConfig.maxAttempts,
        originalTaskId: decision.originalTaskId || String(taskItem._id),
        finalTaskId: String(taskItem._id),
        errorMessage: triggerReason
    }, function (claimErr, claimResult) {
        if (claimErr) {
            console.error('Claim retry failed for decision ' + decisionId + ':', claimErr.message);
            return;
        }
        if (TaskCtrl.getUpdateMatchedCount(claimResult) <= 0) {
            return;
        }

        var runRetry = function () {
            TaskCtrl.scheduleOursRetryAttempt(taskItem, decision, {
                decisionId: decisionId,
                retryAttempt: nextRetryAttempt,
                triggerReason: triggerReason,
                failedServerId: failedServerId,
                excludedServerMap: excludedServerMap,
                reservationEnabled: reservationEnabled
            });
        };

        if (retryConfig.delayMs > 0) {
            return setTimeout(runRetry, retryConfig.delayMs);
        }
        return runRetry();
    });
}

TaskCtrl.scheduleOursRetryAttempt = function (taskItem, decision, retryOptions) {
    var ServersCtrl = require('./servers');
    var pid = taskItem.t_pid;
    var scheduleStartTime = new Date();
    var scheduleStartMs = Date.now();
    var contextStartMs = Date.now();
    ServersCtrl.buildSchedulingContext(pid, taskItem.t_inputs || [], {}, function (contextErr, context) {
        var contextBuildMs = Date.now() - contextStartMs;
        if (contextErr) {
            return ScheduleDecisionCtrl.finishRetry(retryOptions.decisionId, {
                status: 'retry_failed',
                errorMessage: contextErr.message
            }, function () {});
        }

        ServersCtrl.scoreSchedulingContext(context, {
            decisionId: retryOptions.decisionId,
            schedulePolicy: 'OURS_LLM',
            experimentGroup: decision.experimentGroup || '',
            reservationEnabled: retryOptions.reservationEnabled,
            scheduleStartTime: scheduleStartTime,
            contextBuildMs: contextBuildMs
        }, function (scoreErr, scoreResult) {
            if (scoreErr) {
                return ScheduleDecisionCtrl.finishRetry(retryOptions.decisionId, {
                    status: 'retry_failed',
                    errorMessage: scoreErr.message
                }, function () {});
            }

            var rankedServers = (scoreResult.servers || []).filter(function (ranked) {
                return !retryOptions.excludedServerMap[String(ranked.serverId)];
            });
            var reservationAttempts = [];
            var reservationFailureCount = 0;
            var reservationStartMs = Date.now();

            var finishNoRetryServer = function () {
                ScheduleDecisionCtrl.pushRetryAttempt(retryOptions.decisionId, {
                    retryAttempt: retryOptions.retryAttempt,
                    stage: 'no_alternative_server',
                    failedServerId: retryOptions.failedServerId,
                    triggerReason: retryOptions.triggerReason,
                    timestamp: new Date()
                }, {
                    status: 'retry_failed',
                    retryInProgress: false,
                    errorMessage: 'No alternative server available for retry',
                    reservationAttempts: reservationAttempts,
                    reservationFailureCount: reservationFailureCount
                }, function () {});
            };

            var dispatchRetry = function (ranked, selectedServer, reservationId, reservationMs, slotGrantedTime) {
                var dispatchStartMs = Date.now();
                ScheduleDecisionCtrl.pushRetryAttempt(retryOptions.decisionId, {
                    retryAttempt: retryOptions.retryAttempt,
                    stage: 'dispatch_started',
                    fromServerId: retryOptions.failedServerId,
                    serverId: String(selectedServer._id),
                    score: ranked.score,
                    predictedDuration: ranked.predictedDuration,
                    reservationId: reservationId || '',
                    triggerReason: retryOptions.triggerReason,
                    timestamp: new Date()
                }, {
                    status: 'retry_dispatching',
                    selectedServerId: String(selectedServer._id),
                    selectedScore: ranked.score,
                    selectedPredictedDuration: ranked.predictedDuration,
                    selectedRawPredictedDuration: ranked.rawPredictedDuration,
                    selectedCalibratedPredictedDuration: ranked.predictedDuration,
                    predictionCalibrationFactor: ranked.calibrationFactor,
                    predictionCalibrationSampleCount: ranked.calibrationSampleCount,
                    selectedEstimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                    selectedEstimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                    selectedEstimatedWaitMs: ranked.estimatedWaitMs,
                    selectedEstimatedCompletionMs: ranked.estimatedCompletionMs,
                    predictionConfidence: ranked.predictionConfidence,
                    predictionEvidenceSource: ranked.predictionEvidenceSource,
                    reservationId: reservationId || '',
                    reservationMs: reservationMs,
                    reservationAttempts: reservationAttempts,
                    reservationFailureCount: reservationFailureCount
                }, function () {});

                TaskCtrl.dispatchExistingTask(taskItem, selectedServer, {
                    decisionId: retryOptions.decisionId,
                    retryAttempt: retryOptions.retryAttempt,
                    selectedScore: ranked.score,
                    selectedPredictedDuration: ranked.predictedDuration,
                    selectedRawPredictedDuration: ranked.rawPredictedDuration,
                    predictionCalibrationFactor: ranked.calibrationFactor,
                    predictionCalibrationSampleCount: ranked.calibrationSampleCount,
                    selectedEstimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                    selectedEstimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                    selectedEstimatedWaitMs: ranked.estimatedWaitMs,
                    selectedEstimatedCompletionMs: ranked.estimatedCompletionMs,
                    predictionConfidence: ranked.predictionConfidence,
                    predictionEvidenceSource: ranked.predictionEvidenceSource,
                    enqueuedTime: taskItem.t_enqueuedTime || scheduleStartTime,
                    slotGrantedTime: slotGrantedTime,
                    reservationId: reservationId || '',
                    note: 'Retry attempt ' + retryOptions.retryAttempt + ' after Error: ' + retryOptions.triggerReason
                }, function (dispatchErr) {
                    var dispatchMs = Date.now() - dispatchStartMs;
                    var totalScheduleMs = Date.now() - scheduleStartMs;
                    if (dispatchErr) {
                        return ScheduleDecisionCtrl.pushRetryAttempt(retryOptions.decisionId, {
                            retryAttempt: retryOptions.retryAttempt,
                            stage: 'dispatch_error',
                            serverId: String(selectedServer._id),
                            reason: dispatchErr.message,
                            timestamp: new Date()
                        }, {
                            status: 'retry_dispatch_error',
                            dispatchMs: dispatchMs,
                            totalScheduleMs: totalScheduleMs,
                            errorMessage: dispatchErr.message
                        }, function () {});
                    }
                    return ScheduleDecisionCtrl.upsertByDecisionId(retryOptions.decisionId, {
                        scheduleEndTime: new Date(),
                        totalScheduleMs: totalScheduleMs,
                        dispatchMs: dispatchMs
                    }, function () {});
                });
            };

            var tryRankedServer = function (index) {
                if (index >= rankedServers.length) {
                    return finishNoRetryServer();
                }

                var ranked = rankedServers[index];
                var selectedServer = (context.servers || []).find(function (server) {
                    return String(server._id) === String(ranked.serverId);
                });
                if (!selectedServer) {
                    return tryRankedServer(index + 1);
                }

                if (!retryOptions.reservationEnabled) {
                    return dispatchRetry(ranked, selectedServer, '', 0, new Date());
                }

                TaskReservationCtrl.reserve({
                    serverId: selectedServer._id,
                    pid: pid,
                    decisionId: retryOptions.decisionId,
                    requestId: (decision.requestId || '') + ':retry:' + retryOptions.retryAttempt,
                    maxSlots: ranked.maxServerSlots,
                    maxAdmissionSlots: ranked.maxAdmissionSlots,
                    observedUnreservedTaskCount: ranked.observedUnreservedTaskCount,
                    capacityOverflow: ranked.capacityOverflow,
                    rawPredictedDuration: ranked.rawPredictedDuration,
                    predictedDuration: ranked.predictedDuration,
                    calibrationFactor: ranked.calibrationFactor,
                    estimatedWaitMs: ranked.estimatedWaitMs,
                    estimatedCompletionMs: ranked.estimatedCompletionMs
                }, function (reservationErr, reservation) {
                    if (reservationErr) {
                        reservationFailureCount++;
                        reservationAttempts.push({
                            serverId: String(ranked.serverId),
                            score: ranked.score,
                            success: false,
                            reason: reservationErr.message,
                            retryAttempt: retryOptions.retryAttempt,
                            timestamp: new Date()
                        });
                        ScheduleDecisionCtrl.pushRetryAttempt(retryOptions.decisionId, {
                            retryAttempt: retryOptions.retryAttempt,
                            stage: 'reservation_failed',
                            serverId: String(ranked.serverId),
                            score: ranked.score,
                            reason: reservationErr.message,
                            timestamp: new Date()
                        }, {
                            reservationAttempts: reservationAttempts,
                            reservationFailureCount: reservationFailureCount
                        }, function () {});
                        return tryRankedServer(index + 1);
                    }

                    reservationAttempts.push({
                        serverId: String(ranked.serverId),
                        score: ranked.score,
                        success: true,
                        reason: '',
                        retryAttempt: retryOptions.retryAttempt,
                        timestamp: new Date()
                    });
                    return dispatchRetry(
                        ranked,
                        selectedServer,
                        reservation.reservationId,
                        Date.now() - reservationStartMs,
                        reservation.createdAt || new Date()
                    );
                });
            };

            return tryRankedServer(0);
        });
    });
}

TaskCtrl.createAndDispatchTask = function (taskData, selectedServer, options, callback) {
    options = options || {};
    var pid = taskData.pid;
    var task = {
        t_msrid: '',
        t_pid: pid,
        t_server: selectedServer._id,
        t_inputs: taskData.inputs,
        t_outputs: taskData.outputs,
        t_user: taskData.username,
        t_status: 'Inited',
        t_type: selectedServer.s_type,
        t_note: '',
        t_datetime: new Date(),
        t_enqueuedTime: options.enqueuedTime || new Date(),
        t_slotGrantedTime: options.slotGrantedTime || new Date(),
        t_startTime: null,
        t_endTime: null,
        t_totalInputSize: options.totalInputSize || 0,
        t_decisionId: options.decisionId || '',
        t_reservationId: options.reservationId || ''
    };

    TaskCtrl.add(task, function (err, taskItem) {
        if (err) {
            return callback(err);
        }

        if (options.decisionId) {
            ScheduleDecisionCtrl.upsertByDecisionId(options.decisionId, {
                status: 'task_created',
                taskId: String(taskItem._id),
                reservationId: options.reservationId || '',
                selectedServerId: String(selectedServer._id),
                selectedScore: options.selectedScore,
                selectedPredictedDuration: options.selectedPredictedDuration,
                selectedRawPredictedDuration: options.selectedRawPredictedDuration,
                selectedCalibratedPredictedDuration: options.selectedPredictedDuration,
                predictionCalibrationFactor: options.predictionCalibrationFactor,
                predictionCalibrationSampleCount: options.predictionCalibrationSampleCount,
                selectedEstimatedStartupDelayMs: options.selectedEstimatedStartupDelayMs,
                selectedEstimatedQueueWaitMs: options.selectedEstimatedQueueWaitMs,
                selectedEstimatedWaitMs: options.selectedEstimatedWaitMs,
                selectedEstimatedCompletionMs: options.selectedEstimatedCompletionMs,
                predictionConfidence: options.predictionConfidence || '',
                predictionEvidenceSource: options.predictionEvidenceSource || '',
                schedulePolicy: options.schedulePolicy || options.scheduleMode || '',
                experimentGroup: options.experimentGroup || '',
                reservationEnabled: options.reservationEnabled !== false,
                decisionMode: options.scheduleMode || '',
                fallback: !!options.fallback,
                fallbackReason: options.fallbackReason || ''
            }, function (logErr) {
                if (logErr) {
                    console.error('Update schedule decision task_created failed for decision ' + options.decisionId + ':', logErr);
                }
            });
        }

        var taskinfo = {
            "pid": pid,
            "taskid": taskItem._id,
            "inputs": JSON.stringify(taskData.inputs),
            "username": taskData.username,
            "ipport": selectedServer.s_ip + ':' + selectedServer.s_port,
            "outputs": JSON.stringify(taskData.outputs)
        };

        if (selectedServer.s_type == 1) {
            var ServersCtrl = require('./servers');
            ServersCtrl.sendTask(selectedServer, taskinfo, options.dispatchFallbackServers || [], function (sendErr, tdata) {
                if (sendErr) {
                    taskItem.t_status = 'Error';
                    taskItem.t_note = sendErr.message;
                    taskItem.t_endTime = new Date();
                    TaskCtrl.update(taskItem, function () {});
                    TaskCtrl.markTerminal(taskItem, 'Error', sendErr.message);
                    return callback(sendErr, taskItem);
                }

                taskItem.t_server = tdata.server._id;
                taskItem.t_msrid = tdata.msrid;
                taskItem.t_status = 'Started';
                taskItem.t_startTime = new Date();

                TaskCtrl.update(taskItem, function (updateErr) {
                    if (updateErr) {
                        return callback(updateErr, taskItem);
                    }
                    if (options.decisionId) {
                        ScheduleDecisionCtrl.upsertByDecisionId(options.decisionId, {
                            status: 'started',
                            taskId: String(taskItem._id),
                            actualTaskStatus: 'Started',
                            actualStartTime: taskItem.t_startTime || null,
                            selectedServerId: String(tdata.server._id),
                            reservationId: options.reservationId || ''
                        }, function (logErr) {
                            if (logErr) {
                                console.error('Update schedule decision started failed for decision ' + options.decisionId + ':', logErr);
                            }
                        });
                    }
                    TaskCtrl.startLocalTaskPolling(taskItem, tdata);
                    return callback(null, taskItem, tdata.server);
                });
            });
        } else {
            return callback(null, taskItem, selectedServer);
        }
    });
}

//没办法分配的任务 将状态设置为Error
var changeTaskStatus2Error = function (task, msg) {
    task.t_status = "Error";
    task.t_endTime = new Date();
    TaskCtrl.update(task, function (err, result) {
        if (err) {
            console.log("update task error:" + err.message);
            return;
        }
        if (task.t_reservationId) {
            TaskReservationCtrl.release(task.t_reservationId, function (releaseErr) {
                if (releaseErr) {
                    console.log("release reservation error:" + releaseErr.message);
                }
            });
        }
        console.log(msg);
    });
}
