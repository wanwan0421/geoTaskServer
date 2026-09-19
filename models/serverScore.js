/**
 * Author : Wanwan
 * Date : 2025/7/16
 * Description : Record the model task run
 */

var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var ServerScore = function (scoreData) {
    this.schemaVersion = 4;
    this.mspid = '';
    this.serverId = '';
    this.serverIP = '';
    this.totalScore = 0;
    this.decisionId = '';
    this.decisionMode = '';
    this.fallback = false;
    this.fallbackReason = '';
    this.predictedDuration = null;
    this.rawPredictedDuration = null;
    this.calibratedPredictedDuration = null;
    this.calibrationFactor = 1;
    this.predictionSource = '';
    this.predictionConfidence = '';
    this.predictionEvidenceSource = '';
    this.estimatedStartupDelayMs = null;
    this.estimatedQueueWaitMs = null;
    this.estimatedWaitMs = null;
    this.estimatedCompletionMs = null;
    this.rawDynamicWeights = null;
    this.dynamicWeights = null;
    this.weightSource = '';
    this.policyConfidence = '';
    this.policyEvidenceUsed = [];
    this.policyEvidenceProfileKey = '';
    this.rawDynamicWeightSum = null;
    this.dynamicWeightSum = null;
    this.weightValidationPassed = false;
    this.weightedContributions = null;

    // 硬件评分字段
    this.cpuRaw = 0;
    this.cpuWeighted = 0;
    this.memoryRaw = 0;
    this.memoryWeighted = 0;
    this.gpuRaw = 0;
    this.gpuWeighted = 0;
    this.vramRaw = 0;
    this.vramWeighted = 0;
    this.diskRaw = 0;
    this.diskWeighted = 0;
    this.networkRaw = 0;
    this.networkWeighted = 0;

    // 模型评分字段
    // this.typeRaw = 0;
    // this.typeWeighted = 0;
    // this.sizeRaw = 0;
    // this.sizeWeighted = 0;
    // this.inputSizeRaw = 0;
    // this.inputSizeWeighted = 0;
    this.durationRaw = 0;
    this.durationWeighted = 0;
    this.reliabilityRaw = 0;
    this.reliabilityWeighted = 0;
    this.reliabilityFinishedCount = 0;
    this.reliabilityErrorCount = 0;

    this.time = new Date();
    this.t_user = null;
    this.reasoning = null;

    if(scoreData) {
        for(const key in scoreData) {
            if(this.hasOwnProperty(key)) {
                this[key] = scoreData[key];
            }
        }
    }
    return this;
}

ServerScore.__proto__ = BaseModel;

var scoreSchema = new mongoose.Schema({
    schemaVersion: Number,
    mspid : String,
    serverId : String,
    serverIP : String,
    totalScore: Number,
    decisionId: String,
    decisionMode: String,
    fallback: Boolean,
    fallbackReason: String,
    predictedDuration: Number,
    rawPredictedDuration: Number,
    calibratedPredictedDuration: Number,
    calibrationFactor: Number,
    predictionSource: String,
    predictionConfidence: String,
    predictionEvidenceSource: String,
    estimatedStartupDelayMs: Number,
    estimatedQueueWaitMs: Number,
    estimatedWaitMs: Number,
    estimatedCompletionMs: Number,
    rawDynamicWeights: mongoose.Schema.Types.Mixed,
    dynamicWeights: mongoose.Schema.Types.Mixed,
    weightSource: String,
    policyConfidence: String,
    policyEvidenceUsed: [String],
    policyEvidenceProfileKey: String,
    rawDynamicWeightSum: Number,
    dynamicWeightSum: Number,
    weightValidationPassed: Boolean,
    weightedContributions: mongoose.Schema.Types.Mixed,

    cpuRaw: Number,
    cpuWeighted: Number,
    memoryRaw: Number,
    memoryWeighted: Number,
    gpuRaw: Number,
    gpuWeighted: Number,
    vramRaw: Number,
    vramWeighted: Number,
    diskRaw: Number,
    diskWeighted: Number,
    networkRaw: Number,
    networkWeighted: Number,
    
    // typeRaw: Number,
    // typeWeighted: Number,
    // sizeRaw: Number,
    // sizeWeighted: Number,
    // inputSizeRaw: Number,
    // inputSizeWeighted: Number,
    durationRaw: Number,
    durationWeighted: Number,
    reliabilityRaw: Number,
    reliabilityWeighted: Number,
    reliabilityFinishedCount: Number,
    reliabilityErrorCount: Number,

    time: {
        type: Date,
        default: Date.now
    },
    user : mongoose.Schema.Types.Mixed,
    reasoning: String
},{collection:'serverscore'});
var scoreModel = mongoose.model('ServerScore', scoreSchema);
ServerScore.baseModel = scoreModel;
ServerScore.modelName = "ServerScore";

module.exports = ServerScore;
