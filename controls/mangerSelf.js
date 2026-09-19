var os = require('os');
var request = require('request');
var setting = require('../setting');
var exec = require('child_process').exec;
// var RegisterCtrl = require('./register');

var MangerSelfCtrl = function () { };

module.exports = MangerSelfCtrl;

/*MangerSelfCtrl.register = function(callback){
    var form = {
        name: os.hostname(),
        host: '',
        port: setting.port,
        system: os.platform()
    };
    MangerSelfCtrl.getIP(function(err, ip){
        if(err){
            return callback(err);
        }
        form.host = ip;
        //send post request to the manager server
        var url = 'http://' + setting.manager.website + '/GeoModeling/taskNode';
        request.post(url, { json: true, body: form }, function (err, response) {
            if (err) {
                return callback(err);
            }
            //data return is json
            var resJson = response.body;
            if (resJson.code == 1) {
                //�������ݿ��¼
                let register_record = {
                    r_mid: resJson.data.id,
                    r_status: true,
                    r_host: resJson.data.host
                };
                RegisterCtrl.add(register_record, function(err, record) {
                    return callback(null, true);
                });
            } else {
                return callback(null, false);
            }
        })
    })
}*/

/*MangerSelfCtrl.unregister = function(callback){
    var form = {
        name: os.hostname(),
        host: '',
        port: setting.port,
        system: os.platform()
    };
    MangerSelfCtrl.getIP(function(err, ip){
        if(err){
            return callback(err);
        }
        form.host = ip;
        //send post request to the manager server
        var url = 'http://' + setting.manager.website + '/GeoModeling/taskNode/unregister';
        request.post(url, { json: true, body: form }, function (err, response) {
            if (err) {
                return callback(err);
            }
            //data return is json
            var resJson = response.body;
            if (resJson.code == 1) {
                RegisterCtrl.getByHost(ip, function(err, record) {
                    if(err) {
                        console.log(err);
                    }
                    let id = record[0]._id;
                    RegisterCtrl.delete(id, function(err, result) {
                        console.log('finish');
                    })
                })
                return callback(null, true);
            } else {
                return callback(null, false);
            }
        })
    })
}*/

MangerSelfCtrl.getIP = function (callback) {
    if (setting.selfIp && setting.selfIp != '') {
        return callback(null, setting.selfIp);
    } else {
        var ipv4 = '';
        var hasFind = false;
        var interfaces = os.networkInterfaces();
        for (var key in interfaces) {
            if (/(loopback|vmware|internal|vethernet)/gi.test(key))
                continue;
            if (ipv4 != '') break;
            var alias = 0;
            for (let item of interfaces[key]) {
                if (item.family === 'IPv4') {
                    if (item.address !== '127.0.0.1') {
                        ipv4 = item.address;
                        hasFind = true;
                        return callback(null, ipv4);
                    }
                }
            }
            if (!hasFind) {
                return callback('can\'t find local IP!');
            }
        }
    }

}


