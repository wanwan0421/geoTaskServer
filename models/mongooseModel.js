/**
 * Created by Administrator on 2016/10/9.
 */
var setting = require('../setting');
var mongoose = require('mongoose');
//加这一句，否则一直提示 mpromise (mongoose's default promise library) is deprecated
mongoose.Promise = require('bluebird');
var url = 'mongodb://' + setting.mongodb.host + ':' + setting.mongodb.port + '/' + setting.mongodb.name;
//是否有带用户名和密码
if (setting.mongodb.username != '' && setting.mongodb.password != '') {
    mongoose.connect(url,{
        useNewUrlParser: true,
        useUnifiedTopology: true,
        user: setting.mongodb.username,
        pass: setting.mongodb.password,
        authSource: setting.mongodb.authSource || setting.mongodb.name
    });
} else {
    mongoose.connect(url,{useNewUrlParser: true, useUnifiedTopology: true});
}

mongoose.connection.on('connected', function () {
    console.log('Mongoose connection open to ' + url);
});

mongoose.connection.on('error',function (err) {
    console.log('Mongoose connection error: ' + err);
});

mongoose.connection.on('disconnected', function () {
    console.log('Mongoose connection disconnected');
});

module.exports = mongoose;
