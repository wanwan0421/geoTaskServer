/**
 * Description: Full scheduling decision log.
 */

var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var ScheduleDecision = function (decision) {
    this.schemaVersion = 4;
    this.decisionId = '';
    this.requestId = '';
    this.pid = '';
    this.username = '';
    this.status = 'scored';
    this.schedulePolicy = 'OURS_LLM';
    this.experimentGroup = '';
    this.recentHistoryTaskCount = null;
    this.reservationEnabled = true;
    this.decisionMode = '';
    this.fallback = false;
    this.fallbackTriggered = false;
    this.fallbackStage = '';
    this.fallbackSuccess = null;
    this.fallbackReason = '';
    this.scheduleStartTime = null;
    this.scheduleEndTime = null;
    this.totalScheduleMs = null;
    this.contextBuildMs = null;
    this.scoringMs = null;
    this.llmStartTime = null;
    this.llmEndTime = null;
    this.llmLatencyMs = null;
    this.llmPromptTokens = null;
    this.llmCompletionTokens = null;
    this.llmTotalTokens = null;
    this.policyCacheKey = '';
    this.policyCacheStatus = '';
    this.policyCacheHit = false;
    this.policyCacheStale = false;
    this.policyRefreshTriggered = false;
    this.policyGeneratedAt = null;
    this.policyExpiresAt = null;
    this.policyConfidence = '';
    this.policyEvidenceUsed = [];
    this.policyEvidenceProfileKey = '';
    this.workloadPolicyEvidence = null;
    this.currentWorkloadPolicyEvidence = null;
    this.repairTriggered = false;
    this.repairAttemptCount = 0;
    this.localRepairTriggered = false;
    this.repairMode = '';
    this.outputRepairTriggered = false;
    this.outputRepairAttemptCount = 0;
    this.providerRetryTriggered = false;
    this.providerRetryCount = 0;
    this.llmCallCount = 0;
    this.localFillCount = 0;
    this.llmAttemptCount = 0;
    this.reservationMs = null;
    this.dispatchMs = null;
    this.totalInputSize = 0;
    this.inputWarnings = [];
    this.inputValidation = null;
    this.modelServices = null;
    this.candidateSnapshot = [];
    this.llmRawOutput = null;
    this.localScores = [];
    this.rankedServers = [];
    this.decisionTrace = null;
    this.selectedServerId = '';
    this.selectedScore = null;
    this.selectedPredictedDuration = null;
    this.selectedRawPredictedDuration = null;
    this.selectedCalibratedPredictedDuration = null;
    this.predictionCalibrationFactor = null;
    this.predictionCalibrationSampleCount = null;
    this.selectedEstimatedStartupDelayMs = null;
    this.selectedEstimatedQueueWaitMs = null;
    this.selectedEstimatedWaitMs = null;
    this.selectedEstimatedCompletionMs = null;
    this.predictionConfidence = '';
    this.predictionEvidenceSource = '';
    this.selectedActualDuration = null;
    this.predictionError = null;
    this.absoluteError = null;
    this.squaredError = null;
    this.absolutePercentageError = null;
    this.biasError = null;
    this.overheadRatio = null;
    this.reservationId = '';
    this.reservationAttempts = [];
    this.reservationFailureCount = 0;
    this.retryEnabled = false;
    this.maxRetryAttempts = 0;
    this.retryCount = 0;
    this.retryInProgress = false;
    this.retryAttempts = [];
    this.originalTaskId = '';
    this.finalTaskId = '';
    this.taskId = '';
    this.actualTaskStatus = '';
    this.success = null;
    this.actualStartTime = null;
    this.actualEndTime = null;
    this.actualDuration = null;
    this.actualQueueWaitMs = null;
    this.actualStartupDelayMs = null;
    this.actualServiceTimeMs = null;
    this.actualCompletionMs = null;
    this.queueWaitPredictionError = null;
    this.queueWaitAbsoluteError = null;
    this.queueWaitAbsolutePercentageError = null;
    this.errorMessage = '';
    this.createdAt = new Date();
    this.updatedAt = new Date();

    if (decision) {
        for (var key in decision) {
            if (this.hasOwnProperty(key)) {
                this[key] = decision[key];
            }
        }
    }
    return this;
}

ScheduleDecision.__proto__ = BaseModel;
module.exports = ScheduleDecision;

var scheduleDecisionSchema = new mongoose.Schema({
    schemaVersion: Number,
    decisionId: String,
    requestId: String,
    pid: String,
    username: String,
    status: String,
    schedulePolicy: String,
    experimentGroup: String,
    recentHistoryTaskCount: Number,
    reservationEnabled: Boolean,
    decisionMode: String,
    fallback: Boolean,
    fallbackTriggered: Boolean,
    fallbackStage: String,
    fallbackSuccess: Boolean,
    fallbackReason: String,
    scheduleStartTime: Date,
    scheduleEndTime: Date,
    totalScheduleMs: Number,
    contextBuildMs: Number,
    scoringMs: Number,
    llmStartTime: Date,
    llmEndTime: Date,
    llmLatencyMs: Number,
    llmPromptTokens: Number,
    llmCompletionTokens: Number,
    llmTotalTokens: Number,
    policyCacheKey: String,
    policyCacheStatus: String,
    policyCacheHit: Boolean,
    policyCacheStale: Boolean,
    policyRefreshTriggered: Boolean,
    policyGeneratedAt: Date,
    policyExpiresAt: Date,
    policyConfidence: String,
    policyEvidenceUsed: [String],
    policyEvidenceProfileKey: String,
    workloadPolicyEvidence: mongoose.Schema.Types.Mixed,
    currentWorkloadPolicyEvidence: mongoose.Schema.Types.Mixed,
    repairTriggered: Boolean,
    repairAttemptCount: Number,
    localRepairTriggered: Boolean,
    repairMode: String,
    outputRepairTriggered: Boolean,
    outputRepairAttemptCount: Number,
    providerRetryTriggered: Boolean,
    providerRetryCount: Number,
    llmCallCount: Number,
    localFillCount: Number,
    llmAttemptCount: Number,
    reservationMs: Number,
    dispatchMs: Number,
    totalInputSize: Number,
    inputWarnings: Array,
    inputValidation: mongoose.Schema.Types.Mixed,
    modelServices: mongoose.Schema.Types.Mixed,
    candidateSnapshot: Array,
    llmRawOutput: mongoose.Schema.Types.Mixed,
    localScores: Array,
    rankedServers: Array,
    decisionTrace: mongoose.Schema.Types.Mixed,
    selectedServerId: String,
    selectedScore: Number,
    selectedPredictedDuration: Number,
    selectedRawPredictedDuration: Number,
    selectedCalibratedPredictedDuration: Number,
    predictionCalibrationFactor: Number,
    predictionCalibrationSampleCount: Number,
    selectedEstimatedStartupDelayMs: Number,
    selectedEstimatedQueueWaitMs: Number,
    selectedEstimatedWaitMs: Number,
    selectedEstimatedCompletionMs: Number,
    predictionConfidence: String,
    predictionEvidenceSource: String,
    selectedActualDuration: Number,
    predictionError: Number,
    absoluteError: Number,
    squaredError: Number,
    absolutePercentageError: Number,
    biasError: Number,
    overheadRatio: Number,
    reservationId: String,
    reservationAttempts: Array,
    reservationFailureCount: Number,
    retryEnabled: Boolean,
    maxRetryAttempts: Number,
    retryCount: Number,
    retryInProgress: Boolean,
    retryAttempts: Array,
    originalTaskId: String,
    finalTaskId: String,
    taskId: String,
    actualTaskStatus: String,
    success: Boolean,
    actualStartTime: Date,
    actualEndTime: Date,
    actualDuration: Number,
    actualQueueWaitMs: Number,
    actualStartupDelayMs: Number,
    actualServiceTimeMs: Number,
    actualCompletionMs: Number,
    queueWaitPredictionError: Number,
    queueWaitAbsoluteError: Number,
    queueWaitAbsolutePercentageError: Number,
    errorMessage: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { collection: 'scheduledecision' });

scheduleDecisionSchema.index({ decisionId: 1 }, { unique: true });
scheduleDecisionSchema.index({ taskId: 1 });
scheduleDecisionSchema.index({ reservationId: 1 });
scheduleDecisionSchema.index({ experimentGroup: 1, schedulePolicy: 1 });

var scheduleDecisionModel = mongoose.model('ScheduleDecision', scheduleDecisionSchema);
ScheduleDecision.baseModel = scheduleDecisionModel;
ScheduleDecision.modelName = "ScheduleDecision";
