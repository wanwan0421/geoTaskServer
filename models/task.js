/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2018/12/27
 * Update : 2025/7/16(wanwan)
 * Description : Task
 */
var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var Task = function (task) {
    this.t_msrid = '';
    this.t_pid = '';
    this.t_server = null;
    this.t_inputs = null;
    this.t_outputs = null;
    this.t_user = null;
    this.t_status = '';
    this.t_type = 1;
    this.t_note = '';
    this.t_msrlogs = '';
    this.t_mlogs = '';
    this.t_datetime = new Date();
    this.t_enqueuedTime = null;
    this.t_slotGrantedTime = null;
    this.t_startTime = null;
    this.t_endTime = null;
    this.t_duration = null;
    this.t_totalInputSize = 0;
    this.t_decisionId = '';
    this.t_reservationId = '';
    if(task && task.t_msrid){
        this.t_msrid = task.t_msrid;
    }
    if(task && task.t_pid){
        this.t_pid = task.t_pid;
    }
    if(task && task.t_server){
        this.t_server = task.t_server;
    }
    if(task && task.t_inputs){
        this.t_inputs = task.t_inputs;
    }
    if(task && task.t_outputs){
        this.t_outputs = task.t_outputs;
    }
    if(task && task.t_user){
        this.t_user = task.t_user;
    }
    if(task && task.t_status){
        this.t_status = task.t_status;
    }
    if(task && task.t_type){
        this.t_type = task.t_type;
    }
    if(task && task.t_note){
        this.t_note = task.t_note;
    }
    if(task && task.t_msrlogs){
        this.t_msrlogs = task.t_msrlogs;
    }
    if(task && task.t_mlogs){
        this.t_mlogs = task.t_mlogs;
    }
    if (task && task.t_datetime) {
        this.t_datetime = task.t_datetime;
    }
    if (task && task.t_enqueuedTime) {
        this.t_enqueuedTime = task.t_enqueuedTime;
    }
    if (task && task.t_slotGrantedTime) {
        this.t_slotGrantedTime = task.t_slotGrantedTime;
    }
    if (task && task.t_startTime) {
        this.t_startTime = task.t_startTime;
    }
    if (task && task.t_endTime) {
        this.t_endTime = task.t_endTime;
    }
    if (task && task.t_duration) {
        this.t_duration = task.t_duration;
    }
    if (task && task.t_totalInputSize) {
        this.t_totalInputSize = task.t_totalInputSize;
    }
    if (task && task.t_decisionId) {
        this.t_decisionId = task.t_decisionId;
    }
    if (task && task.t_reservationId) {
        this.t_reservationId = task.t_reservationId;
    }
    return this;
}

Task.__proto__ = BaseModel;
module.exports = Task;

var taskSchame = new mongoose.Schema({
    t_msrid : String,
    t_pid: String,
    t_server : mongoose.Schema.Types.Mixed,
    t_inputs : Array,
    t_outputs : Array,
    t_user : mongoose.Schema.Types.Mixed,
    t_status : String,
    t_type : Number,
    t_note : String,
    t_msrlogs: Array,
    t_mlogs: Array,
    t_datetime : Date,
    t_enqueuedTime : Date,
    t_slotGrantedTime : Date,
    t_startTime : Date,
    t_endTime : Date,
    t_duration : Number,
    t_totalInputSize : Number,
    t_decisionId : String,
    t_reservationId : String
},{collection:'task'});
var taskModel = mongoose.model('task', taskSchame);
Task.baseModel = taskModel;
Task.modelName = "Task Model";

Task.getByServerAndStatus = function(server_id, status,type, callback){
    this.getByWhere({t_server: server_id, t_status: status, t_type: type}, this.returnFunction(callback, 'Error in getting tasks by server id and inited status'));
}

Task.getAllByStatus = function(status, callback){
    this.getByWhere({t_status: status}, this.returnFunction(callback, 'Error in getting all tasks with status'));
}

Task.getAllByServerAndStatus = function(server_id, callback){
    this.getByWhere({t_server: server_id, t_status: {$regex:"[Inited|Started]"}}, this.returnFunction(callback, 'Error in getting tasks by server id and inited status'));
}

Task.getAllByServerWithPidAndStatus = function(server_id,pid, status, callback){
    this.getByWhere({
        t_server: server_id,
        t_pid: pid,
        t_status: status
    }, this.returnFunction(callback, 'Error in getting tasks by server id and status'));
}

Task.getAllInitedTasks = function(callback){
    this.getByWhere({t_status: "Inited"}, this.returnFunction(callback, 'Error in getting tasks by server id and status'));
}

Task.getAllInitedAndStartedTasks = function(callback){
    this.getByWhere({t_status:{$in: ["Inited","Started"]}}, this.returnFunction(callback, 'Error in getting tasks by status'));
}

Task.getAllFinishedTasksByPid = function (pid,callback) {
    this.getByWhere({t_pid: pid, t_status: "Finished"}, this.returnFunction(callback, 'Error in getting tasks by pid'));
}
