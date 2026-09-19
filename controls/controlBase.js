/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2018/12/28
 * Description : Base model for control layer
 */

var CommonBase = require('../utils/commonBase');

var ControlBase = function () {};
ControlBase.__proto__ = CommonBase;
ControlBase.model = null;

module.exports = ControlBase;

//! add a new item
ControlBase.add = function (item, callback) {
    this.model.save(item,function (err, data) {
        if(err){
            return callback(err);
        }
        else{
            return callback(null,data);
        }
    })
};

//! delete an item by OID
ControlBase.delete = function (oid, callback) {
    this.model.delete(oid,function (err,data) {
        if(err){
            return callback(err);
        }
        else{
            return callback(null,data);
        }
    })
};

//! get an item by OID
ControlBase.getByOID = function (oid, callback) {
    this.model.getByOID(oid,function (err, data) {
        if(err){
            return callback(err);
        }
        else{
            return callback(null,data);
        }
    })
};

//! get items by where
ControlBase.getByWhere = function (where, callback) {
    this.model.getByWhere(where,function (err, data) {
        if(err){
            return callback(err);
        }
        else{
            return callback(null,data);
        }
    })
};

//! update an item
ControlBase.update = function (newItem, callback) {
    this.model.update(newItem,function (err, data) {
        if(err){
            return callback(err);
        }
        else{
            return callback(null,data);
        }
    })
};

//! add a new item
ControlBase.updateByWhere = function (query, update, options, callback) {
    this.model.updateByWhere(query,update,options,function (err, data) {
        if(err){
            return callback(err);
        }
        else{
            return callback(null,data);
        }
    })
};