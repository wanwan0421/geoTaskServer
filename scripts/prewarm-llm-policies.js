'use strict';

var fs = require('fs');
var path = require('path');
var Setting = require('../setting');

function fail(message) {
    throw new Error(message);
}

function parseArgs(argv) {
    var options = { catalog: '', expectedCount: null, force: false, dryRun: false };
    for (var index = 0; index < argv.length; index++) {
        var arg = argv[index];
        if (arg === '--catalog') {
            options.catalog = argv[++index] || '';
        } else if (arg.indexOf('--catalog=') === 0) {
            options.catalog = arg.slice('--catalog='.length);
        } else if (arg === '--expected-count') {
            options.expectedCount = Number(argv[++index]);
        } else if (arg.indexOf('--expected-count=') === 0) {
            options.expectedCount = Number(arg.slice('--expected-count='.length));
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            fail('Unknown argument: ' + arg);
        }
    }
    if (options.expectedCount !== null && (!Number.isInteger(options.expectedCount) || options.expectedCount <= 0)) {
        fail('--expected-count must be a positive integer');
    }
    return options;
}

function printUsage() {
    console.log('Usage: node scripts/prewarm-llm-policies.js --catalog <catalog.json> [options]');
    console.log('Options:');
    console.log('  --expected-count <n>  Fail unless exactly n unique cache policies are found');
    console.log('  --force               Regenerate fresh ready policies');
    console.log('  --dry-run             Validate and list keys without MongoDB or LLM calls');
}

function containsPlaceholder(value) {
    if (typeof value === 'string') {
        var upper = value.toUpperCase();
        return upper.indexOf('REPLACE_') >= 0 || upper.indexOf('__REPLACE') >= 0;
    }
    if (Array.isArray(value)) {
        return value.some(containsPlaceholder);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value).some(function (key) {
            return containsPlaceholder(key) || containsPlaceholder(value[key]);
        });
    }
    return false;
}

function sumInputSizes(value) {
    if (Array.isArray(value)) {
        return value.reduce(function (sum, item) { return sum + sumInputSizes(item); }, 0);
    }
    if (!value || typeof value !== 'object') {
        return 0;
    }
    return Object.keys(value).reduce(function (sum, key) {
        if (String(key).toLowerCase() === 'sizebytes') {
            var size = Number(value[key]);
            if (!Number.isInteger(size) || size <= 0) {
                fail('Invalid sizeBytes value: ' + value[key]);
            }
            return sum + size;
        }
        return sum + sumInputSizes(value[key]);
    }, 0);
}

function getInputSizeThresholds() {
    var configured = Setting.schedule && Setting.schedule.llmPolicyInputSizeBucketsBytes;
    var values = Array.isArray(configured)
        ? configured
        : [1048576, 10485760, 52428800, 209715200, 1073741824];
    return values.map(function (value) {
        return Math.max(0, Math.floor(Number(value) || 0));
    }).filter(function (value) {
        return value > 0;
    }).sort(function (a, b) {
        return a - b;
    });
}

function getInputSizeBucket(totalInputSize) {
    var thresholds = getInputSizeThresholds();
    var size = Math.max(0, Math.floor(Number(totalInputSize) || 0));
    for (var index = 0; index < thresholds.length; index++) {
        if (size <= thresholds[index]) {
            return 'lte_' + thresholds[index];
        }
    }
    return thresholds.length ? 'gt_' + thresholds[thresholds.length - 1] : 'all';
}

function getWorkloadVariants(workload) {
    if (Array.isArray(workload.variants)) {
        return workload.variants;
    }
    return [{
        inputSetId: workload.inputSetId,
        declaredTotalInputSize: workload.declaredTotalInputSize,
        inputs: workload.inputs
    }];
}

function loadPolicySpecs(catalogPath, expectedCount) {
    var resolvedPath = path.resolve(catalogPath);
    var catalog = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        fail('Catalog root must be a JSON object');
    }
    if (Number(catalog.schemaVersion) !== 1) {
        fail('schemaVersion must be 1');
    }
    if (!Array.isArray(catalog.models) || catalog.models.length === 0) {
        fail('models must be a non-empty array');
    }
    if (containsPlaceholder(catalog)) {
        fail('Catalog still contains REPLACE placeholders');
    }

    var policyMap = Object.create(null);
    var workloadIds = Object.create(null);
    catalog.models.forEach(function (model, modelIndex) {
        var modelName = String(model.name || '').trim();
        var pid = String(model.pid || '').trim();
        var modelType = String(model.modelType || '').trim();
        if (!modelName || !pid || !modelType) {
            fail('Model ' + (modelIndex + 1) + ' must define name, pid, and modelType');
        }
        if (!Array.isArray(model.workloads) || model.workloads.length === 0) {
            fail('Model ' + modelName + ' must define workloads');
        }

        model.workloads.forEach(function (workload, workloadIndex) {
            var workloadId = String(workload.workloadId || '').trim();
            if (!workloadId) {
                fail('Model ' + modelName + ' workload ' + (workloadIndex + 1) + ' is missing workloadId');
            }
            if (workloadIds[workloadId]) {
                fail('Duplicate workloadId: ' + workloadId);
            }
            workloadIds[workloadId] = true;
            var variants = getWorkloadVariants(workload);
            if (!variants.length) {
                fail('Workload ' + workloadId + ' has no input variants');
            }

            variants.forEach(function (variant, variantIndex) {
                var inputSetId = String(variant.inputSetId || '').trim();
                if (!inputSetId || !variant.inputs || typeof variant.inputs !== 'object' || Array.isArray(variant.inputs)) {
                    fail('Workload ' + workloadId + ' variant ' + (variantIndex + 1) + ' has invalid inputs');
                }
                var declaredSize = Number(variant.declaredTotalInputSize);
                var measuredSize = sumInputSizes(variant.inputs);
                if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
                    fail('Workload ' + workloadId + ' variant ' + inputSetId + ' has invalid declaredTotalInputSize');
                }
                if (declaredSize !== measuredSize) {
                    fail('Workload ' + workloadId + ' variant ' + inputSetId +
                        ' declaredTotalInputSize (' + declaredSize + ') does not equal sizeBytes sum (' + measuredSize + ')');
                }

                var bucket = getInputSizeBucket(declaredSize);
                var cacheKey = ['workload_policy_v4', pid, modelType, bucket].join('|');
                if (!policyMap[cacheKey]) {
                    policyMap[cacheKey] = {
                        cacheKey: cacheKey,
                        pid: pid,
                        modelName: modelName,
                        modelType: modelType,
                        inputSizeBucket: bucket,
                        sizes: [],
                        workloadIds: [],
                        inputSetIds: []
                    };
                }
                var spec = policyMap[cacheKey];
                if (spec.workloadIds.indexOf(workloadId) < 0) {
                    spec.workloadIds.push(workloadId);
                }
                spec.inputSetIds.push(inputSetId);
                spec.sizes.push(declaredSize);
            });
        });
    });

    var specs = Object.keys(policyMap).sort().map(function (cacheKey) {
        var spec = policyMap[cacheKey];
        if (spec.workloadIds.length > 1) {
            fail('Different workload classes share one cache key: ' + cacheKey +
                ' (' + spec.workloadIds.join(', ') + '). Add an input-size bucket boundary.');
        }
        spec.representativeInputSize = Math.round(spec.sizes.reduce(function (sum, size) {
            return sum + size;
        }, 0) / spec.sizes.length);
        spec.modelServices = {
            modelPid: spec.pid,
            modelType: spec.modelType,
            totalInputSize: spec.representativeInputSize
        };
        return spec;
    });

    if (expectedCount !== null && specs.length !== expectedCount) {
        fail('Expected ' + expectedCount + ' unique cache policies, found ' + specs.length);
    }
    return { catalogPath: resolvedPath, catalog: catalog, specs: specs };
}

function waitForMongo(mongoose) {
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
        var timeout = setTimeout(function () {
            cleanup();
            reject(new Error('Timed out waiting for MongoDB connection'));
        }, 30000);
        function cleanup() {
            clearTimeout(timeout);
            mongoose.connection.removeListener('connected', onConnected);
            mongoose.connection.removeListener('error', onError);
        }
        function onConnected() {
            cleanup();
            resolve();
        }
        function onError(err) {
            cleanup();
            reject(err);
        }
        mongoose.connection.once('connected', onConnected);
        mongoose.connection.once('error', onError);
    });
}

function getCacheRecord(controller, cacheKey) {
    return new Promise(function (resolve, reject) {
        controller.getByKey(cacheKey, function (err, record) {
            return err ? reject(err) : resolve(record || null);
        });
    });
}

function upsertCacheRecord(controller, cacheKey, patch) {
    return new Promise(function (resolve, reject) {
        controller.upsert(cacheKey, patch, function (err, result) {
            return err ? reject(err) : resolve(result);
        });
    });
}

function acquireLease(controller, spec, leaseMs) {
    var now = new Date();
    return new Promise(function (resolve, reject) {
        controller.tryAcquireRefreshLease(spec.cacheKey, {
            pid: spec.pid,
            modelType: spec.modelType,
            inputSizeBucket: spec.inputSizeBucket,
            representativeInputSize: spec.representativeInputSize,
            evidenceVersion: spec.modelServices.workloadPolicyEvidence && spec.modelServices.workloadPolicyEvidence.evidenceVersion || '',
            evidenceProfileKey: spec.modelServices.workloadPolicyEvidence && spec.modelServices.workloadPolicyEvidence.evidenceProfileKey || '',
            status: 'refreshing',
            refreshStartedAt: now,
            refreshLeaseExpiresAt: new Date(now.getTime() + leaseMs)
        }, now, function (err, acquired) {
            return err ? reject(err) : resolve(acquired);
        });
    });
}

function getAvailableServers(serversController, pid) {
    return new Promise(function (resolve, reject) {
        serversController.getByPIDWithStatus(pid, true, function (err, servers) {
            return err ? reject(err) : resolve(servers || []);
        });
    });
}

function populateReliability(serversController, servers, modelServices) {
    return new Promise(function (resolve, reject) {
        serversController.populateServerReliability(servers, modelServices, function (err) {
            return err ? reject(err) : resolve(servers);
        });
    });
}

function collectRuntimeEvidence(serversController, servers, modelServices) {
    return new Promise(function (resolve, reject) {
        serversController.collectRuntimePredictionEvidence(servers, modelServices, function (err, evidence) {
            return err ? reject(err) : resolve(evidence || {});
        });
    });
}

async function attachCurrentWorkloadEvidence(serversController, spec) {
    var servers = await getAvailableServers(serversController, spec.pid);
    await populateReliability(serversController, servers, spec.modelServices);
    var runtimeEvidence = await collectRuntimeEvidence(serversController, servers, spec.modelServices);
    spec.modelServices.workloadPolicyEvidence = serversController.buildWorkloadPolicyEvidence(servers, runtimeEvidence);
    return spec.modelServices.workloadPolicyEvidence;
}

function generatePolicy(serversController, spec) {
    return new Promise(function (resolve, reject) {
        serversController.generateLlmPolicy(
            spec.modelServices,
            spec.cacheKey,
            spec.inputSizeBucket,
            function (err, policy) {
                return err ? reject(err) : resolve(policy);
            }
        );
    });
}

function isFreshReadyPolicy(record, spec, schedulingRepair) {
    if (!record || record.status !== 'ready' || record.promptVersion !== 'workload_policy_v4' || String(record.pid) !== spec.pid ||
        String(record.modelType) !== spec.modelType || String(record.inputSizeBucket) !== spec.inputSizeBucket) {
        return false;
    }
    var requestedEvidenceProfileKey = spec.modelServices.workloadPolicyEvidence &&
        spec.modelServices.workloadPolicyEvidence.evidenceProfileKey || '';
    if (String(record.evidenceProfileKey || '') !== String(requestedEvidenceProfileKey)) {
        return false;
    }
    var expiresAt = record.expiresAt ? new Date(record.expiresAt).getTime() : 0;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return false;
    }
    var rawValidation = schedulingRepair.validateWeightPercentages(record.rawDynamicWeights, spec.modelType);
    if (!rawValidation.valid) {
        return false;
    }
    try {
        schedulingRepair.assertScoringWeights(record.dynamicWeights);
        return true;
    } catch (err) {
        return false;
    }
}

async function prewarm(specs, options) {
    options = options || {};
    if (Setting.schedule && Setting.schedule.llmPolicyCacheEnabled === false) {
        fail('llmPolicyCacheEnabled is false; enable it before prewarming');
    }
    var mongoose = require('../models/mongooseModel');
    var ServersCtrl = require('../controls/servers');
    var LlmPolicyCacheCtrl = require('../controls/llmPolicyCache');
    var SchedulingRepair = require('../utils/schedulingRepair');
    await waitForMongo(mongoose);
    ServersCtrl.configureLlmProxy();

    var schedule = Setting.schedule || {};
    var ttlMs = Math.max(1000, Number(schedule.llmPolicyCacheTtlMs) || 21600000);
    var leaseMs = Math.max(
        1000,
        Number(schedule.llmPolicyRefreshLeaseMs) || 120000,
        (Number(schedule.llmDecisionTimeoutMs) || 60000) + 30000
    );
    var generated = 0;
    var skipped = 0;
    var llmRepaired = 0;
    var localFallback = 0;
    var failures = [];

    try {
        for (var index = 0; index < specs.length; index++) {
            var spec = specs[index];
            var label = '[' + (index + 1) + '/' + specs.length + '] ' + spec.cacheKey;
            try {
                await attachCurrentWorkloadEvidence(ServersCtrl, spec);
                var existing = await getCacheRecord(LlmPolicyCacheCtrl, spec.cacheKey);
                if (!options.force && isFreshReadyPolicy(existing, spec, SchedulingRepair)) {
                    skipped++;
                    console.log(label + ' READY (existing cache kept)');
                    continue;
                }
                var acquired = await acquireLease(LlmPolicyCacheCtrl, spec, leaseMs);
                if (!acquired) {
                    fail('Refresh lease is held by another process');
                }
                console.log(label + ' GENERATING');
                var policy = await generatePolicy(ServersCtrl, spec);
                var generatedAt = new Date();
                await upsertCacheRecord(LlmPolicyCacheCtrl, spec.cacheKey, Object.assign({}, policy, {
                    status: 'ready',
                    generatedAt: generatedAt,
                    expiresAt: new Date(generatedAt.getTime() + ttlMs),
                    refreshLeaseExpiresAt: null,
                    lastError: ''
                }));
                generated++;
                if (policy.repairMode === 'llm_repair') {
                    llmRepaired++;
                }
                if (policy.localRepairTriggered) {
                    localFallback++;
                }
                console.log(label + ' READY mode=' + (policy.repairMode || 'none') +
                    ' weights=' + JSON.stringify(policy.rawDynamicWeights));
            } catch (err) {
                var failure = {
                    cacheKey: spec.cacheKey,
                    error: err.message || String(err)
                }

                if (err.code) {
                    failure.code = err.code;
                }

                if (Array.isArray(err.validationIssues)) {
                    failure.validationIssues = err.validationIssues.slice();
                }

                failures.push(failure);

                try {
                    var hasLastGoodPolicy = false;
                    if (existing && existing.rawDynamicWeights && existing.dynamicWeights) {
                        var existingValidation = SchedulingRepair.validateWeightPercentages(
                            existing.rawDynamicWeights,
                            spec.modelType
                        );
                        try {
                            SchedulingRepair.assertScoringWeights(existing.dynamicWeights);
                            hasLastGoodPolicy = existingValidation.valid;
                        } catch (weightErr) {
                            hasLastGoodPolicy = false;
                        }
                    }
                    await upsertCacheRecord(LlmPolicyCacheCtrl, spec.cacheKey, {
                        status: hasLastGoodPolicy ? 'ready' : 'error',
                        lastError: failure.validationIssues && failure.validationIssues.length > 0
                            ? failure.error + ': ' + failure.validationIssues.join('; ')
                            : failure.error,
                        refreshLeaseExpiresAt: null
                    });
                } catch (saveErr) {
                    failures[failures.length - 1].saveError = saveErr.message || String(saveErr);
                }
                console.error(label + ' FAILED: ' + (err.message || String(err)));
            }
        }

        var ready = 0;
        for (var verifyIndex = 0; verifyIndex < specs.length; verifyIndex++) {
            var record = await getCacheRecord(LlmPolicyCacheCtrl, specs[verifyIndex].cacheKey);
            if (isFreshReadyPolicy(record, specs[verifyIndex], SchedulingRepair)) {
                ready++;
            }
        }
        console.log('Expected policies: ' + specs.length);
        console.log('Ready policies: ' + ready);
        console.log('Generated policies: ' + generated);
        console.log('Skipped existing policies: ' + skipped);
        console.log('LLM-repaired policies: ' + llmRepaired);
        console.log('Local fallback policies: ' + localFallback);
        console.log('Failed policies: ' + failures.length);
        if (options.setProcessExitCode !== false && (ready !== specs.length || failures.length > 0)) {
            process.exitCode = 1;
        }
        return {
            expected: specs.length,
            ready: ready,
            generated: generated,
            skipped: skipped,
            llmRepaired: llmRepaired,
            localFallback: localFallback,
            failed: failures.length,
            failures: failures
        };
    } finally {
        if (options.disconnect !== false) {
            await mongoose.disconnect();
        }
    }
}

async function main() {
    var options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }
    if (!options.catalog) {
        printUsage();
        fail('--catalog is required');
    }
    var result = loadPolicySpecs(options.catalog, options.expectedCount);
    console.log('Catalog: ' + result.catalogPath);
    console.log('Unique cache policies: ' + result.specs.length);
    result.specs.forEach(function (spec, index) {
        console.log('  ' + (index + 1) + '. ' + spec.cacheKey +
            ' size=' + spec.representativeInputSize +
            ' workload=' + spec.workloadIds.join(','));
    });
    if (options.dryRun) {
        console.log('Dry run complete. MongoDB and LLM were not used.');
        return;
    }
    await prewarm(result.specs, options);
}

if (require.main === module) {
    main().catch(function (err) {
        console.error('LLM policy prewarm failed: ' + (err && err.stack ? err.stack : err));
        process.exitCode = 1;
    });
}

module.exports = {
    parseArgs: parseArgs,
    sumInputSizes: sumInputSizes,
    getInputSizeBucket: getInputSizeBucket,
    loadPolicySpecs: loadPolicySpecs,
    isFreshReadyPolicy: isFreshReadyPolicy,
    prewarm: prewarm
};
