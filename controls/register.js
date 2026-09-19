/**
 * Author : Ming Wang
 * Date : 2020/5/11
 * Description : Register Control
 */
var ControlBase = require('./controlBase');
var RegisterModel = require('../models/register');

var RegisterCtrl = function() {};
RegisterCtrl.__proto__ = ControlBase;
RegisterCtrl.model = RegisterModel;

module.exports = RegisterCtrl;

RegisterCtrl.getByHost = function(host, callback) {
    RegisterModel.getByHost(host, this.returnFunction(callback, 'Error in getting register!'));
}

//因为默认就只有一条记录，所以直接查询
RegisterCtrl.getRecord = function(callback) {
    RegisterModel.getByWhere({}, function(err, record) {
        if(err) {
            return callback(err);
        }
        return callback(null, record[0]);
    })
}