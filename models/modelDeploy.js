/**
 * Author: Ming Wang
 * Date: 2020.05.22
 * Description: Model Deploy Task
 */

 const mongoose = require('./mongooseModel');
 const BaseModel = require('./baseModel');

 var DeployTask = function(task) {
    this.d_user = null;
    this.d_status = null;
    this.d_start = null;
    this.d_mac = null;
    this.d_name = null;
    this.d_pid = null;
    this.d_type = null;
    this.d_package = null;
    this.d_finish = null;
    if(task && task.d_user){
        this.d_user = task.d_user;
    }
    if(task && task.d_status){
        this.d_status = task.d_status;
    }
    if(task && task.d_start){
        this.d_start = task.d_start;
    }
    if(task && task.d_mac){
        this.d_mac = task.d_mac;
    }
    if(task && task.d_name){
        this.d_name = task.d_name;
    }
    if(task && task.d_pid){
        this.d_pid = task.d_pid;
    }
    if(task && task.d_user){
        this.d_type = task.d_type;
    }
    if(task && task.d_package){
        this.d_package = task.d_package;
    }
    if(task && task.d_finish){
        this.d_finish = task.d_finish;
    }
    return this;
 }

 DeployTask.__proto__ = BaseModel;
 module.exports = DeployTask;

 var deployTaskSchema = new mongoose.Schema({
    d_user: String,
    d_status: String,
    d_start: Date,
    d_mac: String,
    d_name: String,
    d_pid: String,
    d_type: Number,
    d_package: String,
    d_finish: Date
 },{collection:'deploy'});

 var deployModel = mongoose.model('deploy', deployTaskSchema);
 DeployTask.baseModel = deployModel;
 DeployTask.modelName = "Deploy Model";

 DeployTask.getByMacAndStatus = function(mac, status, type, callback){
     this.getByWhere({d_mac: mac, d_status: status, d_type: type}, this.returnFunction(callback, 'Error in getting tasks by mac and inited status'));
 }