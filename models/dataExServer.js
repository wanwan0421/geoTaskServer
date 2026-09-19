/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2019/1/25
 * Description : Data exchange server
 */

var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var DataExServers = function (dserver) {
    this.ds_ip = '';
    this.ds_port = 0;
    this.ds_status = true;
    if(dserver && dserver.ds_ip){
        this.ds_ip = dserver.ds_ip;
    }
    if(dserver && dserver.ds_port){
        this.ds_port = server.ds_port;
    }
    return this;
}

DataExServers.__proto__ = BaseModel;
module.exports = DataExServers;

var dxserverSchame = new mongoose.Schema({
    ds_ip : String,
    ds_port : Number,
    ds_status: Boolean
},{collection:'dataexserver'});

var dxserverModel = mongoose.model('dataexserver', dxserverSchame);
DataExServers.baseModel = dxserverModel;
DataExServers.modelName = "Data Exchange Server Model";