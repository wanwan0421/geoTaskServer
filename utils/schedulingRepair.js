/**
 * Pure helpers for validating and repairing OURS_LLM scheduling output.
 * Keeping these functions free of database/provider dependencies makes the
 * scheduling invariants easy to exercise in regression tests.
 */

var WEIGHT_DEFINITIONS = [
    { external: 'CPU', internal: 'cpu' },
    { external: 'Memory', internal: 'memory' },
    { external: 'GPU', internal: 'gpu' },
    { external: 'VRAM', internal: 'vram' },
    { external: 'Disk', internal: 'disk' },
    { external: 'Network', internal: 'network' },
    { external: 'Duration', internal: 'duration' },
    { external: 'Reliability', internal: 'reliability' }
];

var INTERNAL_WEIGHT_KEYS = WEIGHT_DEFINITIONS.map(function (item) {
    return item.internal;
});

var EXTERNAL_WEIGHT_KEYS = WEIGHT_DEFINITIONS.map(function (item) {
    return item.external;
});

// Auditable evidence labels accepted from the workload-policy LLM. Keeping
// these labels closed and machine-readable makes policy changes traceable in
// experiments without relying on free-form reasoning text.
var POLICY_EVIDENCE_KEYS = [
    'model_type_prior',
    'input_size',
    'runtime_spread',
    'history_coverage',
    'runtime_uncertainty',
    'reliability_spread',
    'cpu_runtime_association',
    'memory_runtime_association',
    'gpu_runtime_association',
    'gpu_evidence_absence',
    'network_runtime_association',
    'baseline_weights',
    'insufficient_evidence_fallback'
];

var WEIGHT_RULES = {
    exactTotal: 100,
    minimums: {
        Duration: 20,
        Reliability: 10
    },
    modelMinimums: {
        StateSimulation: {
            keys: ['GPU', 'VRAM'],
            minimum: 25,
            name: 'StateSimulation GPU+VRAM'
        },
        TimeSeries: {
            keys: ['Network', 'Duration'],
            minimum: 35,
            name: 'TimeSeries Network+Duration'
        },
        SimpleCalculation: {
            keys: ['CPU', 'Memory'],
            minimum: 20,
            name: 'SimpleCalculation CPU+Memory'
        }
    }
};

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function sumWeights(weights, keys) {
    return (keys || INTERNAL_WEIGHT_KEYS).reduce(function (sum, key) {
        var value = weights && weights[key];
        return typeof value === 'number' && Number.isFinite(value) ? sum + value : NaN;
    }, 0);
}

function getWeightRulesText(modelType) {
    var minimumRules = Object.keys(WEIGHT_RULES.minimums).map(function (key) {
        return key + ' >= ' + WEIGHT_RULES.minimums[key];
    });
    var modelTypes = WEIGHT_RULES.modelMinimums[modelType]
        ? [modelType]
        : (modelType ? [] : Object.keys(WEIGHT_RULES.modelMinimums));
    var modelRules = modelTypes.map(function (type) {
        var rule = WEIGHT_RULES.modelMinimums[type];
        return type + ' ' + rule.keys.join('+') + ' >= ' + rule.minimum;
    });
    return 'Use exactly these keys: ' + EXTERNAL_WEIGHT_KEYS.join(', ') +
        '. Every value must be an integer percentage from 0 to ' + WEIGHT_RULES.exactTotal +
        '. The values must add up to exactly ' + WEIGHT_RULES.exactTotal +
        '. Minimums: ' + minimumRules.concat(modelRules).join('; ') + '.';
}

function allocateIntegerTotal(total, keys, preferences) {
    var normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
    var scores = keys.map(function (key) {
        var value = Number(preferences && preferences[key]);
        return Number.isFinite(value) && value > 0 ? value : 0;
    });
    var scoreSum = scores.reduce(function (sum, value) { return sum + value; }, 0);
    if (scoreSum <= 0) {
        scores = keys.map(function () { return 1; });
        scoreSum = keys.length;
    }
    var allocation = {};
    var assigned = 0;
    var remainders = keys.map(function (key, index) {
        var exact = normalizedTotal * scores[index] / scoreSum;
        var floor = Math.floor(exact);
        allocation[key] = floor;
        assigned += floor;
        return { key: key, remainder: exact - floor, index: index };
    });
    remainders.sort(function (a, b) {
        return b.remainder === a.remainder ? a.index - b.index : b.remainder - a.remainder;
    });
    for (var index = 0; index < normalizedTotal - assigned; index++) {
        allocation[remainders[index % remainders.length].key]++;
    }
    return allocation;
}

function repairWeightPercentages(rawDynamicWeights, modelType, fallbackPercentages) {
    var source = isPlainObject(rawDynamicWeights) ? rawDynamicWeights : {};
    var fallback = isPlainObject(fallbackPercentages) ? fallbackPercentages : {};
    var preferences = {};
    EXTERNAL_WEIGHT_KEYS.forEach(function (key) {
        var rawValue = Number(source[key]);
        var fallbackValue = Number(fallback[key]);
        preferences[key] = Number.isFinite(rawValue) && rawValue >= 0
            ? Math.min(rawValue, WEIGHT_RULES.exactTotal)
            : (Number.isFinite(fallbackValue) && fallbackValue >= 0 ? fallbackValue : 0);
    });

    var repaired = {};
    EXTERNAL_WEIGHT_KEYS.forEach(function (key) { repaired[key] = 0; });
    Object.keys(WEIGHT_RULES.minimums).forEach(function (key) {
        repaired[key] = WEIGHT_RULES.minimums[key];
    });

    var modelRule = WEIGHT_RULES.modelMinimums[modelType];
    if (modelRule) {
        var currentModelMinimum = modelRule.keys.reduce(function (sum, key) {
            return sum + repaired[key];
        }, 0);
        var modelDeficit = Math.max(0, modelRule.minimum - currentModelMinimum);
        var modelAllocation = allocateIntegerTotal(modelDeficit, modelRule.keys, preferences);
        modelRule.keys.forEach(function (key) {
            repaired[key] += modelAllocation[key];
        });
    }

    var reserved = EXTERNAL_WEIGHT_KEYS.reduce(function (sum, key) { return sum + repaired[key]; }, 0);
    var remainingAllocation = allocateIntegerTotal(
        WEIGHT_RULES.exactTotal - reserved,
        EXTERNAL_WEIGHT_KEYS,
        preferences
    );
    EXTERNAL_WEIGHT_KEYS.forEach(function (key) {
        repaired[key] += remainingAllocation[key];
    });

    var validation = validateWeightPercentages(repaired, modelType);
    if (!validation.valid) {
        var err = new Error('Local constrained normalization failed: ' + validation.issues.join('; '));
        err.code = 'LOCAL_WEIGHT_REPAIR_FAILED';
        throw err;
    }
    return validation.validatedPercentages;
}

function validateWeightPercentages(rawDynamicWeights, modelType) {
    var issues = [];
    if (!isPlainObject(rawDynamicWeights)) {
        return {
            valid: false,
            issues: ['rawDynamicWeights must be a plain object'],
            rawDynamicWeights: null,
            validatedPercentages: null,
            rawWeightSum: null,
            missingKeys: EXTERNAL_WEIGHT_KEYS.slice(),
            extraKeys: []
        };
    }

    var source = rawDynamicWeights;
    var selected = {};
    var rawSnapshot = Object.assign({}, source);
    var canCalculateSum = true;
    var missingKeys = EXTERNAL_WEIGHT_KEYS.filter(function (key) {
        return !Object.prototype.hasOwnProperty.call(source, key);
    });
    var extraKeys = Object.keys(source).filter(function (key) {
        return EXTERNAL_WEIGHT_KEYS.indexOf(key) < 0;
    });

    missingKeys.forEach(function (key) {
        issues.push('missing raw dynamic weight: ' + key);
    });
    extraKeys.forEach(function (key) {
        issues.push('unexpected raw dynamic weight: ' + key);
    });

    WEIGHT_DEFINITIONS.forEach(function (definition) {
        var rawValue = source[definition.external];
        selected[definition.external] = rawValue;
        if (!Object.prototype.hasOwnProperty.call(source, definition.external)) {
            canCalculateSum = false;
            return;
        }
        if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
            issues.push('raw dynamic weight must be a finite JSON number: ' + definition.external);
            canCalculateSum = false;
            return;
        }
        if (!Number.isInteger(rawValue)) {
            issues.push('raw dynamic weight must be an integer percentage: ' + definition.external);
        }
        if (rawValue < 0 || rawValue > 100) {
            issues.push('raw dynamic weight must be between 0 and 100: ' + definition.external);
        }
    });

    var rawWeightSum = canCalculateSum
        ? EXTERNAL_WEIGHT_KEYS.reduce(function (sum, key) { return sum + source[key]; }, 0)
        : null;
    if (rawWeightSum !== null && rawWeightSum !== WEIGHT_RULES.exactTotal) {
        issues.push('raw dynamic weight sum must equal exactly 100; received ' + rawWeightSum);
    }

    Object.keys(WEIGHT_RULES.minimums).forEach(function (key) {
        if (typeof source[key] === 'number' && Number.isFinite(source[key]) &&
            source[key] < WEIGHT_RULES.minimums[key]) {
            issues.push(key + ' must be at least ' + WEIGHT_RULES.minimums[key] + ' percentage points');
        }
    });

    var modelRule = WEIGHT_RULES.modelMinimums[modelType];
    if (modelRule) {
        var valuesAreNumbers = modelRule.keys.every(function (key) {
            return typeof source[key] === 'number' && Number.isFinite(source[key]);
        });
        if (valuesAreNumbers) {
            var modelTotal = modelRule.keys.reduce(function (sum, key) { return sum + source[key]; }, 0);
            if (modelTotal < modelRule.minimum) {
                issues.push(modelRule.name + ' must be at least ' + modelRule.minimum + ' percentage points');
            }
        }
    }

    return {
        valid: issues.length === 0,
        issues: issues,
        rawDynamicWeights: rawSnapshot,
        validatedPercentages: issues.length === 0 ? selected : null,
        rawWeightSum: rawWeightSum,
        missingKeys: missingKeys,
        extraKeys: extraKeys
    };
}

function validateScoringWeights(scoringWeights) {
    var issues = [];
    if (!isPlainObject(scoringWeights)) {
        return { valid: false, issues: ['dynamicWeights must be a plain object'], sum: null };
    }
    var missingKeys = INTERNAL_WEIGHT_KEYS.filter(function (key) {
        return !Object.prototype.hasOwnProperty.call(scoringWeights, key);
    });
    var extraKeys = Object.keys(scoringWeights).filter(function (key) {
        return INTERNAL_WEIGHT_KEYS.indexOf(key) < 0;
    });
    missingKeys.forEach(function (key) { issues.push('missing scoring weight: ' + key); });
    extraKeys.forEach(function (key) { issues.push('unexpected scoring weight: ' + key); });

    var canCalculateSum = missingKeys.length === 0;
    INTERNAL_WEIGHT_KEYS.forEach(function (key) {
        var value = scoringWeights[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            issues.push('scoring weight must be a finite number: ' + key);
            canCalculateSum = false;
            return;
        }
        if (value < 0 || value > 1) {
            issues.push('scoring weight must be between 0 and 1: ' + key);
        }
    });
    var total = canCalculateSum
        ? INTERNAL_WEIGHT_KEYS.reduce(function (sum, key) { return sum + scoringWeights[key]; }, 0)
        : null;
    if (total !== null && Math.abs(total - 1) > 1e-12) {
        issues.push('scoring weight sum must equal 1; received ' + total);
    }
    return { valid: issues.length === 0, issues: issues, sum: total };
}

function assertScoringWeights(scoringWeights) {
    var validation = validateScoringWeights(scoringWeights);
    if (!validation.valid) {
        var err = new Error('Invalid dynamicWeights: ' + validation.issues.join('; '));
        err.code = 'INVALID_SCORING_WEIGHTS';
        err.validationIssues = validation.issues;
        throw err;
    }
    return scoringWeights;
}

function toScoringWeights(validatedPercentages, modelType) {
    var validation = validateWeightPercentages(validatedPercentages, modelType);
    if (!validation.valid) {
        var err = new Error('Cannot convert invalid rawDynamicWeights: ' + validation.issues.join('; '));
        err.code = 'INVALID_WEIGHT_PERCENTAGES';
        err.validationIssues = validation.issues;
        throw err;
    }
    var scoringWeights = {};
    WEIGHT_DEFINITIONS.forEach(function (definition) {
        scoringWeights[definition.internal] = validation.validatedPercentages[definition.external] / 100;
    });
    return assertScoringWeights(scoringWeights);
}

function analyzePredictions(rawPredictions, candidateIds, evidenceByServerId) {
    var ids = (candidateIds || []).map(String);
    var candidateSet = {};
    ids.forEach(function (id) { candidateSet[id] = true; });
    var occurrences = {};
    var issues = [];
    var validPredictions = {};
    var validPredictionDetails = {};

    if (!Array.isArray(rawPredictions)) {
        return {
            validPredictions: {},
            validPredictionDetails: {},
            missingIds: ids,
            duplicateIds: [],
            unknownIds: [],
            issues: ['predictedDurations must be an array']
        };
    }

    var unknownIds = [];
    rawPredictions.forEach(function (prediction) {
        if (!prediction || prediction.serverId === undefined || prediction.serverId === null) {
            issues.push('prediction is missing serverId');
            return;
        }
        if (typeof prediction.serverId !== 'string') {
            issues.push('prediction serverId must be a JSON string');
            return;
        }
        var serverId = prediction.serverId;
        if (!candidateSet[serverId]) {
            unknownIds.push(serverId);
            issues.push('prediction contains non-candidate serverId: ' + serverId);
            return;
        }
        occurrences[serverId] = occurrences[serverId] || [];
        occurrences[serverId].push(prediction);
    });

    var duplicateIds = [];
    ids.forEach(function (serverId) {
        var entries = occurrences[serverId] || [];
        if (entries.length > 1) {
            duplicateIds.push(serverId);
            issues.push('duplicate prediction for serverId: ' + serverId);
            return;
        }
        if (entries.length === 1) {
            var rawDuration = entries[0].predictDuration;
            var confidence = entries[0].confidence;
            var evidenceSource = entries[0].evidenceSource;
            var evidence = evidenceByServerId && evidenceByServerId[serverId] || {};
            var minimum = Number(evidence.minPredictDurationMs);
            var maximum = Number(evidence.maxPredictDurationMs);
            var sampleCount = Math.max(0, Number(
                evidence.historySampleCount !== undefined ? evidence.historySampleCount : evidence.sampleCount
            ) || 0);
            var dispersion = Number(evidence.historyDispersionRatio);
            var valid = true;
            if (typeof rawDuration !== 'number' || !Number.isFinite(rawDuration) || rawDuration <= 0 || !Number.isInteger(rawDuration)) {
                issues.push('predictDuration must be a positive integer millisecond value for serverId: ' + serverId);
                valid = false;
            } else if ((Number.isFinite(minimum) && rawDuration < minimum) || (Number.isFinite(maximum) && rawDuration > maximum)) {
                issues.push('predictDuration is outside the local evidence boundary for serverId: ' + serverId);
                valid = false;
            }
            if (['high', 'medium', 'low'].indexOf(confidence) < 0) {
                issues.push('invalid confidence for serverId: ' + serverId);
                valid = false;
            }
            if (['similar_history', 'local_baseline', 'history_and_hardware'].indexOf(evidenceSource) < 0) {
                issues.push('invalid evidenceSource for serverId: ' + serverId);
                valid = false;
            }
            if ((evidenceSource === 'similar_history' || evidenceSource === 'history_and_hardware') && sampleCount <= 0) {
                issues.push('history evidenceSource requires similar history for serverId: ' + serverId);
                valid = false;
            }
            if (evidenceSource === 'local_baseline' && Number.isFinite(Number(evidence.localBaselineServiceTimeMs)) &&
                rawDuration !== Math.round(Number(evidence.localBaselineServiceTimeMs))) {
                issues.push('local_baseline evidenceSource must return the supplied local baseline for serverId: ' + serverId);
                valid = false;
            }
            if (confidence === 'high' && (sampleCount < 3 || !Number.isFinite(dispersion) || dispersion > 0.25)) {
                issues.push('high confidence is inconsistent with history evidence for serverId: ' + serverId);
                valid = false;
            }
            if (confidence === 'medium' && sampleCount <= 0) {
                issues.push('medium confidence requires similar history for serverId: ' + serverId);
                valid = false;
            }
            if (valid) {
                validPredictions[serverId] = rawDuration;
                validPredictionDetails[serverId] = {
                    predictDuration: rawDuration,
                    confidence: confidence,
                    evidenceSource: evidenceSource
                };
            }
        }
    });

    var missingIds = ids.filter(function (serverId) {
        return !Object.prototype.hasOwnProperty.call(validPredictions, serverId);
    });

    return {
        validPredictions: validPredictions,
        validPredictionDetails: validPredictionDetails,
        missingIds: missingIds,
        duplicateIds: duplicateIds,
        unknownIds: unknownIds,
        issues: issues
    };
}

function getRelativeDurationScore(duration, fastestDuration) {
    var value = Number(duration);
    var fastest = Number(fastestDuration);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(fastest) || fastest <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(100, 100 * fastest / value));
}

function median(values) {
    var sorted = (values || []).map(Number).filter(function (value) {
        return Number.isFinite(value);
    }).sort(function (a, b) { return a - b; });
    if (sorted.length === 0) {
        return null;
    }
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedMedian(samples) {
    var accepted = (samples || []).map(function (sample, index) {
        return {
            value: Number(sample && sample.value),
            weight: Number(sample && sample.weight),
            index: index
        };
    }).filter(function (sample) {
        return Number.isFinite(sample.value) && Number.isFinite(sample.weight) && sample.weight > 0;
    }).sort(function (a, b) {
        return a.value === b.value ? a.index - b.index : a.value - b.value;
    });
    if (accepted.length === 0) {
        return null;
    }
    var totalWeight = accepted.reduce(function (sum, sample) { return sum + sample.weight; }, 0);
    var threshold = totalWeight / 2;
    var accumulated = 0;
    for (var index = 0; index < accepted.length; index++) {
        accumulated += accepted[index].weight;
        if (accumulated >= threshold) {
            return accepted[index].value;
        }
    }
    return accepted[accepted.length - 1].value;
}

function estimateCompletionTimeline(options) {
    options = options || {};
    var maxSlots = Math.max(1, Math.floor(Number(options.maxSlots) || 1));
    var currentDurationMs = Math.max(1, Number(options.currentDurationMs) || 1);
    var runningWorkloads = Array.isArray(options.runningWorkloads) ? options.runningWorkloads.slice() : [];
    var queuedWorkloads = Array.isArray(options.queuedWorkloads) ? options.queuedWorkloads.slice() : [];
    var lanes = [];
    var assignments = [];

    for (var index = 0; index < maxSlots; index++) {
        lanes.push({ laneIndex: index, availableAtMs: 0 });
    }

    var assignToEarliestLane = function (workload, durationMs, phase) {
        lanes.sort(function (a, b) {
            if (a.availableAtMs === b.availableAtMs) {
                return a.laneIndex - b.laneIndex;
            }
            return a.availableAtMs - b.availableAtMs;
        });
        var lane = lanes[0];
        var startsAtMs = lane.availableAtMs;
        lane.availableAtMs += Math.max(1, Number(durationMs) || 1);
        assignments.push({
            id: workload && workload.id !== undefined ? String(workload.id) : '',
            status: workload && workload.status || phase,
            source: workload && workload.source || '',
            laneIndex: lane.laneIndex,
            startsAtMs: startsAtMs,
            durationMs: Math.max(1, Number(durationMs) || 1),
            finishesAtMs: lane.availableAtMs
        });
    };

    runningWorkloads.forEach(function (workload) {
        assignToEarliestLane(workload, workload && workload.remainingMs, 'Started');
    });
    queuedWorkloads.sort(function (a, b) {
        var timeA = new Date(a && a.queuedAt || 0).getTime();
        var timeB = new Date(b && b.queuedAt || 0).getTime();
        if (timeA === timeB) {
            return String(a && a.id || '').localeCompare(String(b && b.id || ''));
        }
        return timeA - timeB;
    }).forEach(function (workload) {
        assignToEarliestLane(workload, workload && workload.durationMs, 'Inited');
    });

    lanes.sort(function (a, b) {
        if (a.availableAtMs === b.availableAtMs) {
            return a.laneIndex - b.laneIndex;
        }
        return a.availableAtMs - b.availableAtMs;
    });
    var estimatedWaitMs = Math.max(0, lanes[0].availableAtMs);
    return {
        estimatedWaitMs: estimatedWaitMs,
        estimatedCompletionMs: estimatedWaitMs + currentDurationMs,
        lanes: lanes.slice().sort(function (a, b) { return a.laneIndex - b.laneIndex; }),
        assignments: assignments
    };
}

function isRetryableLlmError(err) {
    var statusCode = Number(err && err.statusCode);
    var code = String((err && err.code) || '').toUpperCase();
    var message = String((err && err.message) || err || '').toLowerCase();

    if (statusCode === 401 || statusCode === 403 || message.indexOf('api key') >= 0 ||
        message.indexOf('unauthorized') >= 0 || message.indexOf('forbidden') >= 0 ||
        message.indexOf('prompt too large') >= 0 || message.indexOf('configuration') >= 0) {
        return false;
    }
    if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
        return true;
    }
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ESOCKETTIMEDOUT'].indexOf(code) >= 0) {
        return true;
    }
    return message.indexOf('timeout') >= 0 || message.indexOf('network') >= 0 ||
        message.indexOf('socket') >= 0 || message.indexOf('fetch failed') >= 0 ||
        message.indexOf('http 429') >= 0 || /http 5\d\d/.test(message);
}

module.exports = {
    WEIGHT_DEFINITIONS: WEIGHT_DEFINITIONS,
    EXTERNAL_WEIGHT_KEYS: EXTERNAL_WEIGHT_KEYS,
    INTERNAL_WEIGHT_KEYS: INTERNAL_WEIGHT_KEYS,
    POLICY_EVIDENCE_KEYS: POLICY_EVIDENCE_KEYS,
    WEIGHT_RULES: WEIGHT_RULES,
    getWeightRulesText: getWeightRulesText,
    validateWeightPercentages: validateWeightPercentages,
    repairWeightPercentages: repairWeightPercentages,
    toScoringWeights: toScoringWeights,
    validateScoringWeights: validateScoringWeights,
    assertScoringWeights: assertScoringWeights,
    analyzePredictions: analyzePredictions,
    getRelativeDurationScore: getRelativeDurationScore,
    median: median,
    weightedMedian: weightedMedian,
    estimateCompletionTimeline: estimateCompletionTimeline,
    isRetryableLlmError: isRetryableLlmError,
    sumWeights: sumWeights
};
