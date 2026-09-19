/**
 * Description: Temporary reservation for atomic task scheduling.
 */

var mongoose = require('./mongooseModel');
var BaseModel = require('./baseModel');

var TaskReservation = function (reservation) {
    this.reservationId = '';
    this.decisionId = '';
    this.requestId = '';
    this.pid = '';
    this.serverId = '';
    this.slot = 0;
    this.lockKey = '';
    this.status = 'active';
    this.taskId = '';
    this.rawPredictedDuration = null;
    this.predictedDuration = null;
    this.calibrationFactor = 1;
    this.estimatedWaitMs = null;
    this.estimatedCompletionMs = null;
    this.createdAt = new Date();
    this.expiresAt = new Date();
    this.occupiedAt = null;
    this.releasedAt = null;

    if (reservation) {
        for (var key in reservation) {
            if (this.hasOwnProperty(key)) {
                this[key] = reservation[key];
            }
        }
    }
    return this;
}

TaskReservation.__proto__ = BaseModel;
module.exports = TaskReservation;

var reservationSchema = new mongoose.Schema({
    reservationId: String,
    decisionId: String,
    requestId: String,
    pid: String,
    serverId: String,
    slot: Number,
    lockKey: String,
    status: String,
    taskId: String,
    rawPredictedDuration: Number,
    predictedDuration: Number,
    calibrationFactor: Number,
    estimatedWaitMs: Number,
    estimatedCompletionMs: Number,
    createdAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: Date,
    occupiedAt: Date,
    releasedAt: Date
}, { collection: 'taskreservation' });

reservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
reservationSchema.index({ lockKey: 1 }, { unique: true, sparse: true });

var reservationModel = mongoose.model('TaskReservation', reservationSchema);
TaskReservation.baseModel = reservationModel;
TaskReservation.modelName = "TaskReservation";
