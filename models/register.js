/**
 * Author : Ming Wang
 * Date : 2020/5/11
 * Description : Server Register
 */

 const mongoose = require('./mongooseModel');
 const BaseModel = require('./baseModel');


 var Register = function(register) {

 }

 Register.__proto__ = BaseModel;
 module.exports = Register;

 //该集合文档下只会有一条数据记录
 var registerSchema = new mongoose.Schema({
     r_mid: String,
     r_status: Boolean,
     r_host: String
 }, {collection:'register'});

 var registerModel = mongoose.model('register', registerSchema);
 Register.baseModel = registerModel;
 Register.modelName = 'Register Model';

 Register.getByMID = function(mid, callback) {
     this.getByWhere({r_mid:mid}, this.returnFunction(callback, 'Error in getting register by manager server id'));
 }

 Register.getByHost = function(r_host, callback) {
     this.getByWhere({r_host: r_host}, this.returnFunction(callback, 'Error in getting register by host'));
 }