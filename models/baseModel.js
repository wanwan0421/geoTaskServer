/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2018/12/27
 * Description : Model Base
 */
var CommonBase = require('../utils/commonBase');
var ParamCheck = require('../utils/paramCheck');
var ObjectId = require('mongodb').ObjectID;

var BaseModel = function () {};
BaseModel.__proto__ = CommonBase;
this.baseModel = null;
this.modelName = "";

module.exports = BaseModel;

//! New item
BaseModel.save = function (item, callback) {
    var newItem = new this.baseModel(item);
    newItem.save(function (err, rst) {
        if(err){
            console.log('mongoDB err in save!');
            return callback(err);
        }
        else{
            rst = JSON.parse(JSON.stringify(rst));
            return callback(null,rst);
        }
    });
};

//! Delete one item
BaseModel.delete = function (_oid, callback) {
    if(ParamCheck.checkParam(callback, _oid))
    {
        var oid = new ObjectId(_oid);
        this.baseModel.remove({_id: oid},this.returnFunction(callback, "Error in removing" + this.modelName));
    }
};

//! Get item by OID
BaseModel.getByOID = function(_oid,callback){
    if(ParamCheck.checkParam(callback, _oid))
    {
        var oid = new ObjectId(_oid);
        this.baseModel.findOne({'_id' : oid}, this.returnFunction(callback, 'Error in getting a ' + this.modelName + ' by id'));
    }
};

//! Get items by where
BaseModel.getByWhere = function (where, callback) {
    if(ParamCheck.checkParam(callback, where))
    {
        this.baseModel.find(where).sort({'_id':-1}).exec(this.returnFunction(callback, 'Error in getting a ' + this.modelName + ' by where'));
    }
};

//! Update item
BaseModel.update = function (newItem, callback) {
    var where = {'_id':newItem._id};
    var toUpdate = newItem;
    this.baseModel.updateOne(where,toUpdate,this.returnFunction(callback, 'Error in updating a ' + this.modelName + ' by where'));
};

//! Update item by where
BaseModel.updateByWhere = function (where, update,options, callback) {
    this.baseModel.update(where,update,options,this.returnFunction(callback, 'Error in updating a ' + this.modelName + ' by where'));
};

//! Update or insert
BaseModel.upsert = function (where, update, cb) {
    this.baseModel.update(where, update, true, function (err, rst) {
        if(err){
            return cb(err);
        }
        else {
            return cb(null,rst);
        }
    })
};
