/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2019/1/23
 * Description : Server
 */

var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var Servers = function (server) {
    this.s_ip = '';
    this.s_port = 0;
    this.s_mac = '';
    this.s_type = 0;
    this.s_services = [];
    this.s_status = false;
    this.s_user = '';
    this.s_hardware = {};
    this.s_software = [];
    this.s_dynamic = {};
    this.s_datetime = {};
    this.s_runningtask = 0;
    if(server && server.s_ip){
        this.s_ip = server.s_ip;
    }
    if(server && server.s_port){
        this.s_port = server.s_port;
    }
    if(server && server.s_mac){
        this.s_mac = server.s_mac;
    }
    if(server && server.s_type){
        this.s_type = server.s_type;
    }
    if(server && server.s_services){
        this.s_services = server.s_services;
    }
    if(server && server.s_status){
        this.s_status = server.s_status;
    }
    if(server && server.s_user){
        this.s_user = server.s_user;
    }
    if(server && server.s_hardware){
        this.s_hardware = server.s_hardware;
    }
    if(server && server.s_software){
        this.s_software = server.s_software;
    }
    if(server && server.s_dynamic){
        this.s_dynamic = server.s_dynamic;
    }
    if(server && server.s_datetime){
        this.s_datetime = server.s_datetime;
    }
    if(server && server.s_runningtask){
        this.s_runningtask = server.s_runningtask;
    }
    return this;
}

Servers.__proto__ = BaseModel;
module.exports = Servers;

var serverSchame = new mongoose.Schema({
    s_ip : {
        type: String,
        required: true,
        trim: true
    },
    s_port : Number,
    s_mac : String,
    s_type : Number,
    s_services : Array,
    s_status: Boolean,
    s_user: String,
    s_hardware:mongoose.Schema.Types.Mixed,
    s_software: Array,
    s_dynamic: mongoose.Schema.Types.Mixed,
    s_datetime: Date,
    s_runningtask: Number
},{collection:'server'});
serverSchame.index(
    {s_ip: 1},
    {
        unique: true,
        name: 'uniq_server_ip',
        partialFilterExpression: {s_ip: {$type: 'string'}}
    }
);
var serverModel = mongoose.model('server', serverSchame);
Servers.baseModel = serverModel;
Servers.modelName = "Server Model";

Servers.getByMac = function (mac, callback) {
    this.getByWhere({s_mac : mac}, this.returnFunction(callback, 'Error in getting servers by mac address'));
};

Servers.getAll = function (callback) {
    this.getByWhere({}, this.returnFunction(callback, 'Error in getting all servers'));
};

Servers.getByIP = function (ip, callback) {
    this.getByWhere({s_ip : ip}, this.returnFunction(callback, 'Error in getting servers by mac address'));
};

// Register a container atomically by IP. MongoDB's _id remains the internal
// primary key; the unique s_ip index is the business identity for registration.
Servers.registerByIP = function (ip, registration, callback) {
    var now = new Date();
    this.baseModel.findOneAndUpdate(
        {s_ip: ip},
        {
            $set: {
                s_port: registration.s_port,
                s_mac: registration.s_mac,
                s_type: registration.s_type,
                s_status: true,
                s_user: registration.s_user,
                s_datetime: now
            },
            $setOnInsert: {
                s_ip: ip,
                s_services: [],
                s_hardware: {},
                s_software: [],
                s_dynamic: {},
                s_runningtask: 0
            }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            rawResult: true
        },
        this.returnFunction(callback, 'Error in registering server by IP')
    );
};

Servers.getByPID = function (pid, callback) {
    this.getByWhere({"s_services.p_id": pid}, this.returnFunction(callback, 'Error in getting servers by pid'));
};

Servers.getAll = function(callback){
    this.getByWhere({}, this.returnFunction(callback, 'Error in getting all servers'));
};

Servers.getByPIDWithStatus = function(pid, status, callback) {
    this.getByWhere({"s_services.p_id": pid, s_status: status}, this.returnFunction(callback, 'Erro in getting servers by model pid'));
}

Servers.getByTypeWithStatus = function(type, status, callback){
    this.getByWhere({s_type: type, s_status: status}, this.returnFunction(callback, 'Error in getting servers by type'));
};

Servers.getAvailable = function(callback){
    this.getByWhere({s_status: true}, this.returnFunction(callback, 'Error in getring all available Service'));
}

Servers.getById = function(id,callback){
    this.getByOID(id, this.returnFunction(callback, 'Error in get server by id'));
}
