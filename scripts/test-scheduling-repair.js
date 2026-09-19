'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var mongoose = require('mongoose');
var originalMongooseConnect = mongoose.connect;
mongoose.connect = function () { return Promise.resolve(mongoose); };
var ServersCtrl = require('../controls/servers');
var TaskCtrl = require('../controls/task');
var SchedulingRepair = require('../utils/schedulingRepair');
var ScheduleDecision = require('../models/scheduleDecision');
var ServerScore = require('../models/serverScore');
mongoose.connect = originalMongooseConnect;

function callRuntime(servers, modelServices, evidence) {
    return new Promise(function (resolve, reject) {
        ServersCtrl.callRuntimePredictionNode(servers, modelServices, evidence, function (err, result) {
            return err ? reject(err) : resolve(result);
        });
    });
}

function generatePolicy(modelServices) {
    var bucket = ServersCtrl.getLlmPolicyInputSizeBucket(modelServices.totalInputSize);
    return new Promise(function (resolve, reject) {
        ServersCtrl.generateLlmPolicy(
            modelServices,
            ServersCtrl.buildLlmPolicyCacheKey(modelServices),
            bucket,
            function (err, result) { return err ? reject(err) : resolve(result); }
        );
    });
}

function makeServers() {
    return [{
        _id: 'server-a',
        s_ip: '10.0.0.1',
        s_hardware: {
            cpu_Core: 16,
            cpuInfo: 0.99,
            freeMemory: '32GB',
            freeDisk: '500GB',
            theoreticalSpeed: 10000,
            runningIns: 9,
            gpu: [{ model: 'NVIDIA RTX A6000', vramMB: 49152 }]
        }
    }, {
        _id: 'server-b',
        s_ip: '10.0.0.2',
        s_hardware: {
            cpu_Core: 8,
            cpuInfo: 0.01,
            freeMemory: '16GB',
            freeDisk: '250GB',
            theoreticalSpeed: 1000,
            runningIns: 0,
            gpu: []
        }
    }];
}

async function main() {
    assert.deepStrictEqual(SchedulingRepair.EXTERNAL_WEIGHT_KEYS, [
        'CPU', 'Memory', 'GPU', 'VRAM', 'Disk', 'Network', 'Duration', 'Reliability'
    ]);
    assert.strictEqual(
        new Set(SchedulingRepair.POLICY_EVIDENCE_KEYS).size,
        SchedulingRepair.POLICY_EVIDENCE_KEYS.length
    );
    assert.deepStrictEqual(ServersCtrl.getDefaultScheduleWeightPercentages('StateSimulation'), {
        CPU: 10, Memory: 10, GPU: 16, VRAM: 12, Disk: 6, Network: 6, Duration: 30, Reliability: 10
    });
    assert.deepStrictEqual(ServersCtrl.getDefaultScheduleWeightPercentages('TimeSeries'), {
        CPU: 12, Memory: 10, GPU: 5, VRAM: 3, Disk: 7, Network: 11, Duration: 42, Reliability: 10
    });
    assert.deepStrictEqual(ServersCtrl.getDefaultScheduleWeightPercentages('Unknown'), {
        CPU: 14, Memory: 12, GPU: 7, VRAM: 5, Disk: 9, Network: 9, Duration: 34, Reliability: 10
    });
    assert.ok(SchedulingRepair.validateWeightPercentages(
        ServersCtrl.getDefaultScheduleWeightPercentages('TimeSeries'),
        'TimeSeries'
    ).valid);
    assert.ok(!SchedulingRepair.validateWeightPercentages({
        CPU: 10, Memory: 10, GPU: 10, VRAM: 10, Disk: 10, Network: 10, Duration: 20, Reliability: 9
    }, 'TimeSeries').valid);

    var modelServices = {
        modelPid: 'opaque-model-id',
        modelType: 'TimeSeries',
        totalInputSize: 10485760
    };
    var policyData = ServersCtrl.buildLlmPolicyUserData(modelServices, 'lte_10485760');
    assert.deepStrictEqual(Object.keys(policyData), [
        'requestType', 'promptVersion', 'scenario', 'objective', 'modelPid', 'modelType',
        'totalInputSize', 'inputSizeBucket', 'inputSizeBucketRange', 'baselineWeights', 'workloadEvidence'
    ]);
    assert.strictEqual(policyData.promptVersion, 'workload_policy_v4');
    assert.strictEqual(policyData.workloadEvidence.evidenceQuality.level, 'insufficient');
    var insufficientPolicyPayload = {
        rawDynamicWeights: ServersCtrl.getDefaultScheduleWeightPercentages('TimeSeries'),
        policyConfidence: 'low',
        evidenceUsed: ['baseline_weights', 'insufficient_evidence_fallback'],
        reasoning: 'No observed history; baseline retained.'
    };
    assert.ok(ServersCtrl.validateLlmPolicyPayload(
        insufficientPolicyPayload,
        'TimeSeries',
        policyData
    ).valid);
    var unsupportedInsufficientChange = JSON.parse(JSON.stringify(insufficientPolicyPayload));
    unsupportedInsufficientChange.rawDynamicWeights.CPU++;
    unsupportedInsufficientChange.rawDynamicWeights.Memory--;
    assert.ok(!ServersCtrl.validateLlmPolicyPayload(
        unsupportedInsufficientChange,
        'TimeSeries',
        policyData
    ).valid);
    assert.strictEqual(
        ServersCtrl.buildLlmPolicyCacheKey(modelServices),
        'workload_policy_v4|opaque-model-id|TimeSeries|lte_10485760'
    );

    var servers = makeServers();
    var evidence = {
        'server-a': {
            localBaselineServiceTimeMs: 1000,
            minPredictDurationMs: 250,
            maxPredictDurationMs: 4000,
            sampleCount: 4,
            historyDispersionRatio: 0.1,
            history: [{ inputSizeBytes: 100, serviceTimeMs: 1000 }]
        },
        'server-b': {
            localBaselineServiceTimeMs: 2000,
            minPredictDurationMs: 500,
            maxPredictDurationMs: 8000,
            sampleCount: 0,
            historyDispersionRatio: null,
            history: []
        }
    };
    servers[0].reliability = 0.95;
    servers[0].finishedCount = 4;
    servers[0].errorCount = 0;
    servers[1].reliability = 0.65;
    servers[1].finishedCount = 1;
    servers[1].errorCount = 2;
    var workloadEvidence = ServersCtrl.buildWorkloadPolicyEvidence(servers, {
        'server-a': Object.assign({}, evidence['server-a']),
        'server-b': {
            localBaselineServiceTimeMs: 4000,
            minPredictDurationMs: 1000,
            maxPredictDurationMs: 16000,
            sampleCount: 3,
            historyDispersionRatio: 0.2,
            history: [{ inputSizeBytes: 100, serviceTimeMs: 4000 }]
        }
    });
    assert.strictEqual(workloadEvidence.candidateCount, 2);
    assert.strictEqual(workloadEvidence.runtimeHistory.coverageRatio, 1);
    assert.strictEqual(workloadEvidence.runtimeHistory.matureCoverageRatio, 1);
    assert.strictEqual(workloadEvidence.crossNodeRuntimeDifference.spreadBand, 'high');
    assert.strictEqual(workloadEvidence.reliabilityDifference.spreadBand, 'high');
    assert.strictEqual(workloadEvidence.evidenceQuality.level, 'high');
    assert.strictEqual(JSON.stringify(workloadEvidence).indexOf('server-a'), -1);
    modelServices.workloadPolicyEvidence = workloadEvidence;
    policyData = ServersCtrl.buildLlmPolicyUserData(modelServices, 'lte_10485760');
    assert.strictEqual(policyData.workloadEvidence.evidenceProfileKey, workloadEvidence.evidenceProfileKey);
    var runtimeData = ServersCtrl.buildRuntimePredictionUserData(servers, modelServices, evidence);
    var serializedRuntimeData = JSON.stringify(runtimeData);
    ['s_ip', 'cpuInfo', 'runningIns', 'reliability', 'reservation', 'queue'].forEach(function (forbidden) {
        assert.strictEqual(serializedRuntimeData.indexOf(forbidden), -1, forbidden + ' leaked into runtime input');
    });
    assert.strictEqual(runtimeData.candidates[0].similarHistory.length, 1);
    assert.strictEqual(runtimeData.candidates[0].cpuCoreCount, 16);

    var schema = ServersCtrl.buildRuntimePredictionResponseSchema();
    assert.strictEqual(schema.additionalProperties, false);
    assert.strictEqual(schema.properties.predictedDurations.items.additionalProperties, false);
    assert.strictEqual(schema.properties.predictedDurations.items.properties.predictDuration.type, 'integer');

    var invalidAnalysis = SchedulingRepair.analyzePredictions([
        { serverId: 'server-a', predictDuration: 1000.5, confidence: 'high', evidenceSource: 'similar_history' },
        { serverId: 'server-a', predictDuration: 1000, confidence: 'high', evidenceSource: 'similar_history' },
        { serverId: 'unknown', predictDuration: 1000, confidence: 'low', evidenceSource: 'local_baseline' }
    ], ['server-a', 'server-b'], evidence);
    assert.deepStrictEqual(invalidAnalysis.duplicateIds, ['server-a']);
    assert.deepStrictEqual(invalidAnalysis.unknownIds, ['unknown']);
    assert.deepStrictEqual(invalidAnalysis.missingIds, ['server-a', 'server-b']);

    var originalCall = ServersCtrl.callOpenAICompatibleLlm;
    var runtimeCalls = [];
    try {
        ServersCtrl.callOpenAICompatibleLlm = function (options, callback) {
            runtimeCalls.push(options);
            var payload = runtimeCalls.length === 1 ? {
                predictedDurations: [
                    { serverId: 'server-a', predictDuration: 900, confidence: 'high', evidenceSource: 'similar_history' },
                    { serverId: 'server-b', predictDuration: 9000, confidence: 'low', evidenceSource: 'local_baseline' }
                ],
                reasoning: 'initial'
            } : {
                predictedDurations: [
                    { serverId: 'server-b', predictDuration: 2000, confidence: 'low', evidenceSource: 'local_baseline' }
                ],
                reasoning: 'repair'
            };
            return callback(null, {
                completionText: JSON.stringify(payload),
                usageMetadata: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
                providerCallCount: 1
            });
        };
        var runtimeResult = await callRuntime(servers, modelServices, evidence);
        assert.strictEqual(runtimeCalls.length, 2);
        assert.strictEqual(runtimeCalls[0].schemaName, 'runtime_prediction_v4');
        assert.strictEqual(runtimeCalls[1].schemaName, 'scheduling_repair_v4');
        assert.strictEqual(runtimeCalls[1].userData.targetNode, 'runtime_prediction');
        assert.deepStrictEqual(runtimeCalls[1].userData.invalidOrMissingServerIds, ['server-b']);
        assert.strictEqual(runtimeResult.predictionsByServerId['server-a'].predictDuration, 900);
        assert.strictEqual(runtimeResult.predictionsByServerId['server-b'].predictDuration, 2000);
        assert.strictEqual(runtimeResult.localFillCount, 0);

        ServersCtrl.callOpenAICompatibleLlm = function (options, callback) {
            var err = new Error('HTTP 429');
            err.statusCode = 429;
            err.providerCallCount = 1;
            return callback(err);
        };
        var fallbackResult = await callRuntime(servers, modelServices, evidence);
        assert.strictEqual(fallbackResult.localFillCount, 2);
        assert.strictEqual(fallbackResult.predictionsByServerId['server-a'].predictDuration, 1000);
        assert.strictEqual(fallbackResult.predictionsByServerId['server-b'].predictDuration, 2000);
    } finally {
        ServersCtrl.callOpenAICompatibleLlm = originalCall;
    }

    var policyCalls = [];
    try {
        ServersCtrl.callOpenAICompatibleLlm = function (options, callback) {
            policyCalls.push(options);
            var weights = policyCalls.length === 1
                ? { CPU: 100 }
                : ServersCtrl.getDefaultScheduleWeightPercentages('TimeSeries');
            return callback(null, {
                completionText: JSON.stringify({
                    rawDynamicWeights: weights,
                    policyConfidence: 'high',
                    evidenceUsed: ['runtime_spread', 'history_coverage', 'reliability_spread'],
                    reasoning: 'High coverage with a large runtime and reliability spread.'
                }),
                usageMetadata: null,
                providerCallCount: 1
            });
        };
        var policy = await generatePolicy(modelServices);
        assert.strictEqual(policyCalls.length, 2);
        assert.strictEqual(policyCalls[0].schemaName, 'workload_policy_v4');
        assert.deepStrictEqual(policyCalls[0].userData, policyData);
        assert.strictEqual(policyCalls[1].userData.targetNode, 'workload_policy');
        assert.strictEqual(policy.promptVersion, 'workload_policy_v4');
        assert.strictEqual(policy.weightSource, 'llm');
        assert.strictEqual(policy.policyConfidence, 'high');
        assert.deepStrictEqual(policy.evidenceUsed, ['runtime_spread', 'history_coverage', 'reliability_spread']);
        assert.strictEqual(policy.evidenceProfileKey, workloadEvidence.evidenceProfileKey);
    } finally {
        ServersCtrl.callOpenAICompatibleLlm = originalCall;
    }

    var statePolicyCalls = [];
    var stateModelServices = {
        modelPid: 'opaque-state-model-id',
        modelType: 'StateSimulation',
        totalInputSize: 1032709808,
        workloadPolicyEvidence: JSON.parse(JSON.stringify(workloadEvidence))
    };
    stateModelServices.workloadPolicyEvidence.resourceRuntimeAssociations.gpuCapability.interpretation =
        'insufficient_evidence';
    try {
        ServersCtrl.callOpenAICompatibleLlm = function (options, callback) {
            statePolicyCalls.push(options);
            var invalidPayload = {
                rawDynamicWeights: {
                    CPU: 10, Memory: 10, GPU: 16, VRAM: 12,
                    Disk: 6, Network: 5, Duration: 30, Reliability: 10
                },
                policyConfidence: 'high',
                evidenceUsed: ['gpu_runtime_association'],
                reasoning: 'Invalid policy used to exercise targeted repair.'
            };
            var validPayload = {
                rawDynamicWeights: ServersCtrl.getDefaultScheduleWeightPercentages('StateSimulation'),
                policyConfidence: 'high',
                evidenceUsed: ['baseline_weights'],
                reasoning: 'Unsupported GPU evidence removed and exact total restored.'
            };
            return callback(null, {
                completionText: JSON.stringify(statePolicyCalls.length < 3 ? invalidPayload : validPayload),
                usageMetadata: null,
                providerCallCount: 1
            });
        };
        var statePolicy = await generatePolicy(stateModelServices);
        assert.strictEqual(statePolicyCalls.length, 3);
        assert.strictEqual(statePolicyCalls[1].userData.repairConstraints.rawDynamicWeights.receivedTotal, 99);
        assert.strictEqual(statePolicyCalls[1].userData.repairConstraints.rawDynamicWeights.requiredTotal, 100);
        assert.strictEqual(statePolicyCalls[1].userData.repairConstraints.rawDynamicWeights.totalCorrectionNeeded, 1);
        assert.ok(statePolicyCalls[1].userData.repairConstraints.evidenceUsed.mustExclude
            .indexOf('gpu_runtime_association') >= 0);
        assert.ok(statePolicyCalls[1].userData.repairConstraints.evidenceUsed.allowedValues
            .indexOf('gpu_runtime_association') < 0);
        assert.strictEqual(statePolicy.repairMode, 'llm_repair');
        assert.strictEqual(statePolicy.localRepairTriggered, false);
        assert.strictEqual(SchedulingRepair.sumWeights(
            statePolicy.rawDynamicWeights,
            SchedulingRepair.EXTERNAL_WEIGHT_KEYS
        ), 100);
        assert.deepStrictEqual(statePolicy.evidenceUsed, ['baseline_weights']);
    } finally {
        ServersCtrl.callOpenAICompatibleLlm = originalCall;
    }

    var highCpuLoad = ServersCtrl.calculateLocalScoreDetails(servers[0], 1000);
    var lowCpuLoadServer = JSON.parse(JSON.stringify(servers[0]));
    lowCpuLoadServer.s_hardware.cpuInfo = 0;
    lowCpuLoadServer.s_hardware.runningIns = 0;
    var lowCpuLoad = ServersCtrl.calculateLocalScoreDetails(lowCpuLoadServer, 1000);
    assert.strictEqual(highCpuLoad.cpu, lowCpuLoad.cpu);
    assert.ok(!Object.prototype.hasOwnProperty.call(highCpuLoad, 'runningTasks'));

    var emptyEstimate = ServersCtrl.estimateServerCompletion({
        workloadSnapshot: { maxConcurrentSlots: 1, activeTasks: [], pendingReservations: [] }
    }, 1000, 100);
    var loadedEstimate = ServersCtrl.estimateServerCompletion({
        workloadSnapshot: {
            maxConcurrentSlots: 1,
            runningTaskCount: 1,
            activeTasks: [{
                taskId: 'running-1', status: 'Started', predictedDuration: 10000, startedAt: new Date()
            }],
            pendingReservations: []
        }
    }, 1000, 100);
    assert.strictEqual(emptyEstimate.estimatedQueueWaitMs, 0);
    assert.ok(loadedEstimate.estimatedQueueWaitMs > 0);
    assert.strictEqual(
        loadedEstimate.estimatedCompletionMs,
        loadedEstimate.estimatedQueueWaitMs + loadedEstimate.estimatedStartupDelayMs + 1000
    );

    assert.strictEqual(ServersCtrl.extractStartupDelaySample({
        t_datetime: new Date(0),
        t_startTime: new Date(1000)
    }, 0, 10000), null);
    assert.strictEqual(ServersCtrl.extractStartupDelaySample({
        t_slotGrantedTime: new Date(500),
        t_startTime: new Date(1000),
        t_totalInputSize: 0
    }, 0, 10000).delayMs, 500);

    assert.deepStrictEqual(TaskCtrl.calculateActualTimingMetrics({
        t_enqueuedTime: new Date(1000),
        t_slotGrantedTime: new Date(1500),
        t_startTime: new Date(1750),
        t_endTime: new Date(2750)
    }), {
        actualQueueWaitMs: 500,
        actualStartupDelayMs: 250,
        actualServiceTimeMs: 1000,
        actualCompletionMs: 1750
    });
    assert.deepStrictEqual(TaskCtrl.calculateActualTimingMetrics({
        t_datetime: new Date(1000), t_startTime: new Date(1750), t_endTime: new Date(2750)
    }), {
        actualQueueWaitMs: null,
        actualStartupDelayMs: null,
        actualServiceTimeMs: 1000,
        actualCompletionMs: null
    });

    var originalTaskAdd = TaskCtrl.add;
    var capturedTask = null;
    try {
        TaskCtrl.add = function (task, callback) {
            capturedTask = task;
            return callback(null, Object.assign({ _id: 'task-time-test' }, task));
        };
        await new Promise(function (resolve, reject) {
            TaskCtrl.createAndDispatchTask({
                pid: 'pid-time-test', inputs: [], outputs: [], username: 'test'
            }, {
                _id: 'server-time-test', s_type: 2, s_ip: '127.0.0.1', s_port: 1
            }, {
                enqueuedTime: new Date(1000),
                slotGrantedTime: new Date(1500)
            }, function (err) { return err ? reject(err) : resolve(); });
        });
        assert.strictEqual(capturedTask.t_enqueuedTime.getTime(), 1000);
        assert.strictEqual(capturedTask.t_slotGrantedTime.getTime(), 1500);
        assert.ok(capturedTask.t_datetime instanceof Date);
    } finally {
        TaskCtrl.add = originalTaskAdd;
    }

    assert.strictEqual(new ScheduleDecision().schemaVersion, 4);
    assert.strictEqual(new ServerScore().schemaVersion, 4);
    assert.strictEqual(ScheduleDecision.baseModel.schema.path('schemaDowngradeCount'), undefined);
    assert.strictEqual(ServerScore.baseModel.schema.path('runningTasksRaw'), undefined);

    var source = fs.readFileSync(path.resolve(__dirname, '../controls/servers.js'), 'utf8');
    ['json_object', 'callGemini', 'GoogleGenAI', 'RunningTasks', 'schemaDowngrade'].forEach(function (legacy) {
        assert.strictEqual(source.indexOf(legacy), -1, 'legacy scheduling path remains: ' + legacy);
    });
    var taskRouteSource = fs.readFileSync(path.resolve(__dirname, '../routes/task/index.js'), 'utf8');
    assert.ok(taskRouteSource.indexOf('enqueuedTime: scheduleStartTime') >= 0);
    assert.ok(taskRouteSource.indexOf('reservation.createdAt || new Date()') >= 0);

    console.log('Scheduling v4 regression tests passed.');
}

main().then(function () {
    process.exit(0);
}).catch(function (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
