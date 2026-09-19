/**
 * Cached LLM scheduling policy. Expired records are intentionally retained so
 * the scheduler can keep using the last good policy while refreshing it in the
 * background.
 */

var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var LlmPolicyCache = function (item) {
    Object.assign(this, item || {});
    return this;
};

LlmPolicyCache.__proto__ = BaseModel;
module.exports = LlmPolicyCache;

var schema = new mongoose.Schema({
    cacheKey: { type: String, required: true },
    pid: String,
    modelType: String,
    inputSizeBucket: String,
    representativeInputSize: Number,
    status: String,
    rawDynamicWeights: mongoose.Schema.Types.Mixed,
    dynamicWeights: mongoose.Schema.Types.Mixed,
    weightSource: String,
    policyConfidence: String,
    evidenceUsed: [String],
    reasoning: String,
    evidenceVersion: String,
    evidenceProfileKey: String,
    workloadEvidence: mongoose.Schema.Types.Mixed,
    provider: String,
    model: String,
    promptVersion: String,
    initialRawDynamicWeights: mongoose.Schema.Types.Mixed,
    attemptHistory: [mongoose.Schema.Types.Mixed],
    llmCallCount: Number,
    llmAttemptCount: Number,
    repairTriggered: Boolean,
    repairAttemptCount: Number,
    providerRetryCount: Number,
    localRepairTriggered: Boolean,
    repairMode: String,
    lastValidationIssues: [String],
    llmPromptTokens: Number,
    llmCompletionTokens: Number,
    llmTotalTokens: Number,
    generatedAt: Date,
    expiresAt: Date,
    refreshStartedAt: Date,
    refreshLeaseExpiresAt: Date,
    lastError: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'llmpolicycache' });

schema.index({ cacheKey: 1 }, { unique: true });
schema.index({ pid: 1, modelType: 1, inputSizeBucket: 1 });
schema.index({ evidenceProfileKey: 1 });
schema.index({ expiresAt: 1 });

var model = mongoose.model('LlmPolicyCache', schema);
LlmPolicyCache.baseModel = model;
LlmPolicyCache.modelName = 'LLM Policy Cache';
