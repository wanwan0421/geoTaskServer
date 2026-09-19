'use strict';

var path = require('path');
var LlmPolicyCacheCtrl = require('./llmPolicyCache');
var LlmPolicyPrewarm = require('../scripts/prewarm-llm-policies');
var SchedulingRepair = require('../utils/schedulingRepair');

var CATALOG_PATH = path.resolve(__dirname, '../static/workloads/mixed_workload_catalog.template.json');
var EXPECTED_COUNT = 8;
var jobSequence = 0;
var currentJob = {
    id: '',
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    summary: null,
    error: ''
};

function copyJob() {
    return Object.assign({}, currentJob);
}

function getSpecs() {
    return LlmPolicyPrewarm.loadPolicySpecs(CATALOG_PATH, EXPECTED_COUNT).specs;
}

function getCacheRecord(cacheKey) {
    return new Promise(function (resolve, reject) {
        LlmPolicyCacheCtrl.getByKey(cacheKey, function (err, record) {
            return err ? reject(err) : resolve(record || null);
        });
    });
}

function describePolicy(spec, record) {
    var ready = LlmPolicyPrewarm.isFreshReadyPolicy(record, spec, SchedulingRepair);
    var status = 'missing';
    if (record) {
        if (ready) {
            status = 'ready';
        } else if (record.status === 'refreshing') {
            status = 'refreshing';
        } else if (record.status === 'error') {
            status = 'error';
        } else if (record.status === 'ready' && record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
            status = 'expired';
        } else {
            status = 'invalid';
        }
    }
    return {
        cacheKey: spec.cacheKey,
        workloadIds: spec.workloadIds,
        status: status,
        ready: ready,
        weightSource: record ? (record.weightSource || 'llm') : null,
        repairMode: record && record.repairMode || null,
        llmCallCount: record && record.llmCallCount || 0,
        repairAttemptCount: record && record.repairAttemptCount || 0,
        localRepairTriggered: !!(record && record.localRepairTriggered),
        generatedAt: record && record.generatedAt || null,
        expiresAt: record && record.expiresAt || null,
        lastError: record && record.lastError || ''
    };
}

var LlmPolicyAdminCtrl = function () {};

LlmPolicyAdminCtrl.startPrewarm = function (options, callback) {
    options = options || {};
    if (currentJob.status === 'running') {
        return callback(null, { started: false, job: copyJob() });
    }

    var specs;
    try {
        specs = getSpecs();
    } catch (err) {
        return callback(err);
    }

    jobSequence++;
    currentJob = {
        id: Date.now() + '-' + process.pid + '-' + jobSequence,
        status: 'running',
        startedAt: new Date(),
        finishedAt: null,
        summary: null,
        error: ''
    };

    setImmediate(function () {
        LlmPolicyPrewarm.prewarm(specs, {
            force: options.force === true,
            disconnect: false,
            setProcessExitCode: false
        }).then(function (summary) {
            currentJob.status = summary.ready === summary.expected && summary.failed === 0
                ? 'completed'
                : 'failed';
            currentJob.finishedAt = new Date();
            currentJob.summary = summary;
        }).catch(function (err) {
            currentJob.status = 'failed';
            currentJob.finishedAt = new Date();
            currentJob.error = err.message || String(err);
        });
    });

    return callback(null, { started: true, job: copyJob() });
};

LlmPolicyAdminCtrl.getStatus = function (callback) {
    var specs;
    try {
        specs = getSpecs();
    } catch (err) {
        return callback(err);
    }

    Promise.all(specs.map(function (spec) {
        return getCacheRecord(spec.cacheKey).then(function (record) {
            return describePolicy(spec, record);
        });
    })).then(function (policies) {
        var readyCount = policies.filter(function (policy) { return policy.ready; }).length;
        var strictLlmReadyCount = policies.filter(function (policy) {
            return policy.ready && policy.weightSource === 'llm' && !policy.localRepairTriggered;
        }).length;
        var localFallbackReadyCount = policies.filter(function (policy) {
            return policy.ready && policy.localRepairTriggered;
        }).length;
        return callback(null, {
            catalog: CATALOG_PATH,
            expectedCount: specs.length,
            readyCount: readyCount,
            allReady: readyCount === specs.length,
            strictLlmReadyCount: strictLlmReadyCount,
            localFallbackReadyCount: localFallbackReadyCount,
            allStrictLlm: strictLlmReadyCount === specs.length,
            job: copyJob(),
            policies: policies
        });
    }).catch(callback);
};

module.exports = LlmPolicyAdminCtrl;
