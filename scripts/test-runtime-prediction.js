'use strict';

var assert = require('assert');
var mongoose = require('mongoose');
var originalMongooseConnect = mongoose.connect;
mongoose.connect = function () { return Promise.resolve(mongoose); };
var ServersCtrl = require('../controls/servers');
var TaskCtrl = require('../controls/task');
mongoose.connect = originalMongooseConnect;

function predict(serverId, pid, inputSize) {
    return new Promise(function (resolve) {
        ServersCtrl.predictTaskDurationWithSource(serverId, pid, inputSize, resolve);
    });
}

async function main() {
    var originalAggregate = TaskCtrl.model.baseModel.aggregate;
    var capturedPipeline = null;
    try {
        TaskCtrl.model.baseModel.aggregate = function (pipeline) {
            capturedPipeline = pipeline;
            return { exec: function (callback) { return callback(null, []); } };
        };
        await new Promise(function (resolve, reject) {
            TaskCtrl.getNearestFinishedTasksByInputSize({
                serverId: 'server-query',
                pid: 'pid-query',
                currentInputSize: 1000,
                minimumRatio: 0.5,
                maximumRatio: 2,
                limit: 5
            }, function (err) { return err ? reject(err) : resolve(); });
        });
        assert.strictEqual(capturedPipeline[0].$match.t_server, 'server-query');
        assert.strictEqual(capturedPipeline[0].$match.t_pid, 'pid-query');
        assert.strictEqual(capturedPipeline[0].$match.t_status, 'Finished');
        assert.strictEqual(capturedPipeline[0].$match.t_totalInputSize.$gte, 500);
        assert.strictEqual(capturedPipeline[0].$match.t_totalInputSize.$lte, 2000);
        assert.ok(capturedPipeline[1].$addFields.__inputSizeLogDistance);
        assert.strictEqual(capturedPipeline[3].$limit, 5);
    } finally {
        TaskCtrl.model.baseModel.aggregate = originalAggregate;
    }

    var originalQuery = TaskCtrl.getNearestFinishedTasksByInputSize;
    var calls = [];
    try {
        TaskCtrl.getNearestFinishedTasksByInputSize = function (options, callback) {
            calls.push(options);
            return callback(null, [
                { t_totalInputSize: 100, t_duration: 1000 },
                { t_totalInputSize: 110, t_duration: 1100 },
                { t_totalInputSize: 120, t_duration: 900 },
                { t_totalInputSize: 130, t_duration: 5000 },
                { t_totalInputSize: 140, t_duration: 1050 },
                { t_totalInputSize: 150, t_duration: 9999 }
            ]);
        };

        var prediction = await predict('server-a', 'pid-a', 120);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].serverId, 'server-a');
        assert.strictEqual(calls[0].minimumRatio, 0.5);
        assert.strictEqual(calls[0].maximumRatio, 2);
        assert.strictEqual(calls[0].limit, 5);
        assert.strictEqual(prediction.history.length, 5);
        assert.strictEqual(prediction.sampleCount, 5);
        assert.strictEqual(prediction.source, 'similar_history_weighted_median');
        assert.strictEqual(prediction.localBaselineServiceTimeMs, 1050);
        assert.strictEqual(prediction.minPredictDurationMs, 263);
        assert.strictEqual(prediction.maxPredictDurationMs, 4200);
        assert.ok(prediction.historyDispersionRatio >= 0);

        calls = [];
        TaskCtrl.getNearestFinishedTasksByInputSize = function (options, callback) {
            calls.push(options);
            return callback(null, []);
        };
        var fallback = await predict('server-b', 'pid-b', 1024);
        assert.strictEqual(fallback.source, 'default');
        assert.strictEqual(fallback.sampleCount, 0);
        assert.strictEqual(fallback.historyDispersionRatio, null);
        assert.strictEqual(fallback.minPredictDurationMs, 15000);
        assert.strictEqual(fallback.maxPredictDurationMs, 240000);

        assert.strictEqual(ServersCtrl.calculateWeightedDurationPrediction([
            { t_totalInputSize: 100, t_duration: 1000 },
            { t_totalInputSize: 101, t_duration: 1100 },
            { t_totalInputSize: 10000, t_duration: 9000 }
        ], 100), 1100);
    } finally {
        TaskCtrl.getNearestFinishedTasksByInputSize = originalQuery;
    }

    console.log('Runtime prediction regression tests passed.');
}

main().then(function () {
    process.exit(0);
}).catch(function (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
