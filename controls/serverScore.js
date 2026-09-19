/**
 * Author : Wanwan
 * Date : 2025/7/16
 * Description : Record the model task run control
 */

var ServiceServer = require('modelservicesdk');
var ControlBase = require('./controlBase');
var ServerScore = require('../models/serverScore');
var CommonService = require('../service/CommonService');
var Schedule = require('node-schedule');

var ServerScoreCtrl = function() {};
ServerScoreCtrl.__proto__ = ControlBase;
ServerScoreCtrl.model = ServerScore;

module.exports = ServerScoreCtrl;