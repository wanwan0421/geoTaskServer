/**
 * Created by Franklin on 2017/4/5.
 */
var crypto = require('crypto');

var settings = require('../setting');

function CommonMethod(){}

//! crypto
CommonMethod.crypto = function(buffer, key){
    if(key == undefined || key == null){
        key = settings.crypto.key;
    }
    var encrypted = "";
    var cip = crypto.createCipher(settings.crypto.algorithm, key);
    encrypted += cip.update(buffer, 'binary', 'hex');
    encrypted += cip.final('hex');
    return encrypted;
};

//! decrypto
CommonMethod.decrypto = function(buffer, key){
    if(key == null || key == undefined){
        key = settings.crypto.key;
    }
    try{
        var decrypted = "";
        var decipher = crypto.createDecipher(settings.crypto.algorithm, key);
        decrypted += decipher.update(buffer, 'hex', 'binary');
        decrypted += decipher.final('binary');
        return decrypted;
    }
    catch(ex){
        return "";
    }
};

//! get MD5
CommonMethod.md5 = function(buffer){
    return crypto.createHash('md5').update(buffer).digest('hex');
};

//! encode64
CommonMethod.Encode64 = function(a){
    var keyStr = "ABCDEFGHIJKLMNOP" + "QRSTUVWXYZabcdef" + "ghijklmnopqrstuv" + "wxyz0123456789+/" + "=";
    var b = "";
    var c, chr2, chr3 = "";
    var d, enc2, enc3, enc4 = "";
    var i = 0;
    do {
        c = a.charCodeAt(i++);
        chr2 = a.charCodeAt(i++);
        chr3 = a.charCodeAt(i++);
        d = c >> 2;
        enc2 = ((c & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;
        if (isNaN(chr2)) {
            enc3 = enc4 = 64
        } else if (isNaN(chr3)) {
            enc4 = 64
        };
        b = b + keyStr.charAt(d) + keyStr.charAt(enc2) + keyStr.charAt(enc3) + keyStr.charAt(enc4);
        c = chr2 = chr3 = "";
        d = enc2 = enc3 = enc4 = ""
    } while (i < a.length);
    return b;
}

//! get IP of request
CommonMethod.getIP = function(request){
    var host = request.connection.remoteAddress;
    host = host.substr(host.lastIndexOf(':') + 1);
    if(host == "1"){
        host = "127.0.0.1";
    }
    return host;
};

//! get GUID
CommonMethod.createGUID = function () {
    function _p8(s) {
        var p = (Math.random().toString(16)+"000000000").substr(2,8);
        return s ? "-" + p.substr(0,4) + "-" + p.substr(4,4) : p ;
    }
    return _p8() + _p8(true) + _p8(true) + _p8();
};

//! Array reorder
CommonMethod.arrayReorder = function (arr) {
    var brr = [];
    var num  = arr.length;
    for (var i = 0; i < num; i++){
        var temp = parseInt(Math.random()*(num-i));
        brr.push(arr[temp]);
        arr.splice(temp,1);
    }
    return brr;
}

//! Calculate score
CommonMethod.calculate = function(servers){
    for(var i = 0; i < servers.length; i++){
        var kcu = 1;
        var kcc = 1;
        var km = 1;
        var krt = 1;
        servers[i].s_dynamic.cpuInfo = servers[i].s_dynamic.cpuInfo.replace("%", "");
        servers[i].s_dynamic.cpuInfo = parseFloat(servers[i].s_dynamic.cpuInfo) * 0.01;
        if(servers[i].s_dynamic.cpuInfo > 0.5){
            kcu = 0.5;
            if(servers[i].s_dynamic.cpuInfo > 0.8){
                kcu = 0.3;
            }
        }
        if(servers[i].s_hardware.cpu_Core < 3){
            kcc = 0.3;
        }
        if(servers[i].s_dynamic.freeMemory < 1){
            km = 0.5;
            if(servers[i].s_dynamic.freeMemory < 0.3){
                km = 0.3;
            }
        }
        if(servers[i].s_runningtask > 0){
            krt = 0.7;
            if(servers[i].s_runningtask > 1){
                krt = 0.4;
                if(servers[i].s_runningtask > 2){
                    krt = 0.2;
                }
            }
        }
        score = kcu * kcc * km * krt * (servers[i].s_hardware.cpu_Speed/1024.000 * servers[i].s_hardware.cpu_Core * (1 - servers[i].s_dynamic.cpuInfo) + servers[i].s_dynamic.freeMemory);
        servers[i].score = score;
    }
    servers.sort((a, b)=>{
        return a.score - b.score;
    });
}

module.exports = CommonMethod;