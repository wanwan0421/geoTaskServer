/**
 * Description: Control helpers for full scheduling decision logs.
 */

var ControlBase = require('./controlBase');
var ScheduleDecisionModel = require('../models/scheduleDecision');

var ScheduleDecisionCtrl = function () { };
ScheduleDecisionCtrl.__proto__ = ControlBase;
ScheduleDecisionCtrl.model = ScheduleDecisionModel;

module.exports = ScheduleDecisionCtrl;

ScheduleDecisionCtrl.isDuplicateKeyError = function (err) {
    return err && (err.code === 11000 || err.code === 11001);
}

ScheduleDecisionCtrl.upsertByDecisionId = function (decisionId, patch, callback) {
    callback = callback || function () {};
    if (!decisionId) {
        return callback(null, null);
    }

    var update = Object.assign({}, patch || {}, {
        schemaVersion: 4,
        decisionId: decisionId,
        updatedAt: new Date()
    });

    ScheduleDecisionModel.baseModel.updateOne(
        { decisionId: decisionId },
        {
            $set: update,
            $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true },
        function (err, result) {
            if (ScheduleDecisionCtrl.isDuplicateKeyError(err)) {
                return ScheduleDecisionModel.baseModel.updateOne(
                    { decisionId: decisionId },
                    { $set: update },
                    function (retryErr, retryResult) {
                        return callback(retryErr, retryResult);
                    }
                );
            }
            return callback(err, result);
        }
    );
}

ScheduleDecisionCtrl.updateByTaskId = function (taskId, patch, callback) {
    callback = callback || function () {};
    if (!taskId) {
        return callback(null, null);
    }

    var update = Object.assign({}, patch || {}, {
        updatedAt: new Date()
    });

    ScheduleDecisionModel.baseModel.updateOne(
        { taskId: String(taskId) },
        { $set: update },
        function (err, result) {
            return callback(err, result);
        }
    );
}

ScheduleDecisionCtrl.getByTaskId = function (taskId, callback) {
    callback = callback || function () {};
    if (!taskId) {
        return callback(null, null);
    }

    ScheduleDecisionModel.baseModel.findOne(
        { taskId: String(taskId) },
        function (err, decision) {
            return callback(err, decision);
        }
    );
}

ScheduleDecisionCtrl.getByDecisionId = function (decisionId, callback) {
    callback = callback || function () {};
    if (!decisionId) {
        return callback(null, null);
    }

    ScheduleDecisionModel.baseModel.findOne(
        { decisionId: decisionId },
        function (err, decision) {
            return callback(err, decision);
        }
    );
}

ScheduleDecisionCtrl.claimRetry = function (decisionId, currentRetryCount, patch, callback) {
    callback = callback || function () {};
    if (!decisionId) {
        return callback(null, null);
    }

    var retryCount = Number(currentRetryCount || 0);
    var query = {
        decisionId: decisionId,
        retryInProgress: { $ne: true }
    };
    if (retryCount <= 0) {
        query.$or = [
            { retryCount: 0 },
            { retryCount: null },
            { retryCount: { $exists: false } }
        ];
    } else {
        query.retryCount = retryCount;
    }

    var update = {
        $set: Object.assign({}, patch || {}, {
            retryInProgress: true,
            updatedAt: new Date()
        }),
        $inc: { retryCount: 1 }
    };

    ScheduleDecisionModel.baseModel.updateOne(query, update, function (err, result) {
        return callback(err, result);
    });
}

ScheduleDecisionCtrl.finishRetry = function (decisionId, patch, callback) {
    callback = callback || function () {};
    if (!decisionId) {
        return callback(null, null);
    }

    ScheduleDecisionModel.baseModel.updateOne(
        { decisionId: decisionId },
        {
            $set: Object.assign({}, patch || {}, {
                retryInProgress: false,
                updatedAt: new Date()
            })
        },
        function (err, result) {
            return callback(err, result);
        }
    );
}

ScheduleDecisionCtrl.pushRetryAttempt = function (decisionId, attempt, patch, callback) {
    callback = callback || function () {};
    if (!decisionId) {
        return callback(null, null);
    }

    ScheduleDecisionModel.baseModel.updateOne(
        { decisionId: decisionId },
        {
            $push: { retryAttempts: attempt || {} },
            $set: Object.assign({}, patch || {}, {
                updatedAt: new Date()
            })
        },
        function (err, result) {
            return callback(err, result);
        }
    );
}
