/**
 * Description: Reservation control for atomic scheduling.
 */

var ControlBase = require('./controlBase');
var TaskReservationModel = require('../models/taskReservation');
var TaskModel = require('../models/task');
var ScheduleDecisionModel = require('../models/scheduleDecision');
var Setting = require('../setting');
var uuidv4 = require('uuid/v4');

var TaskReservationCtrl = function () { };
TaskReservationCtrl.__proto__ = ControlBase;
TaskReservationCtrl.model = TaskReservationModel;

module.exports = TaskReservationCtrl;

TaskReservationCtrl.getTtlMs = function () {
    return (Setting.schedule && Setting.schedule.reservationTtlMs) || 60000;
}

TaskReservationCtrl.getMaxSlots = function () {
    return (Setting.schedule && Setting.schedule.maxServerSlots);
}

TaskReservationCtrl.getReservationSlotLimit = function (maxAdmissionSlots, unreservedActiveTaskCount) {
    return Math.max(0,
        Math.floor(Math.max(1, Number(maxAdmissionSlots) || TaskReservationCtrl.getMaxSlots())) -
        Math.max(0, Number(unreservedActiveTaskCount) || 0)
    );
}

TaskReservationCtrl.expireStale = function (callback) {
    TaskReservationModel.baseModel.updateMany(
        { status: 'active', expiresAt: { $lte: new Date() } },
        { $set: { status: 'expired' }, $unset: { lockKey: '' } },
        function (err, result) {
            return callback(err, result);
        }
    );
}

TaskReservationCtrl.reserve = function (params, callback) {
    var ttlMs = params.ttlMs || TaskReservationCtrl.getTtlMs();
    var maxAdmissionSlots = Math.floor(Math.max(1, Number(params.maxAdmissionSlots || params.maxSlots || TaskReservationCtrl.getMaxSlots())));
    var serverId = String(params.serverId);
    var now = new Date();

    if (params.capacityOverflow) {
        var overflowError = new Error('Server capacity telemetry exceeds the configured execution slots for server ' + serverId);
        overflowError.code = 'SERVER_CAPACITY_OVERFLOW';
        return callback(overflowError);
    }

    TaskReservationCtrl.getServerLoad([params.serverId], function (err, loadByServer) {
        if (err) {
            return callback(err);
        }

        var load = loadByServer[serverId] || {};
        var observedUnreserved = Math.max(
            Number(params.observedUnreservedTaskCount) || 0,
            Number(load.unreservedActiveTaskCount) || 0
        );
        var reservationSlotLimit = TaskReservationCtrl.getReservationSlotLimit(maxAdmissionSlots, observedUnreserved);
        var liveReservationCount = (Number(load.activeReservationCount) || 0) +
            (Number(load.occupiedReservationCount) || 0);
        if (reservationSlotLimit <= 0 || liveReservationCount >= reservationSlotLimit) {
            return callback(new Error('No reservation slot available for server ' + serverId));
        }

        var trySlot = function (slot) {
            if (slot >= reservationSlotLimit) {
                return callback(new Error('No reservation slot available for server ' + serverId));
            }

            var reservation = {
                reservationId: uuidv4(),
                decisionId: params.decisionId || '',
                requestId: params.requestId || '',
                pid: params.pid || '',
                serverId: serverId,
                slot: slot,
                lockKey: serverId + ':' + slot,
                status: 'active',
                taskId: '',
                rawPredictedDuration: params.rawPredictedDuration,
                predictedDuration: params.predictedDuration,
                calibrationFactor: params.calibrationFactor,
                estimatedWaitMs: params.estimatedWaitMs,
                estimatedCompletionMs: params.estimatedCompletionMs,
                createdAt: now,
                expiresAt: new Date(now.getTime() + ttlMs)
            };

            TaskReservationModel.save(reservation, function (saveErr, saved) {
                if (saveErr) {
                    if (saveErr.code === 11000) {
                        return trySlot(slot + 1);
                    }
                    return callback(saveErr);
                }
                return callback(null, saved);
            });
        };

        trySlot(0);
    });
}

TaskReservationCtrl.occupy = function (reservationId, taskId, callback) {
    if (!reservationId) {
        return callback(null, null);
    }

    TaskReservationModel.baseModel.updateOne(
        { reservationId: reservationId, status: 'active' },
        { $set: { status: 'occupied', taskId: String(taskId || ''), occupiedAt: new Date(), expiresAt: null } },
        function (err, result) {
            return callback(err, result);
        }
    );
}

TaskReservationCtrl.release = function (reservationId, callback) {
    if (!reservationId) {
        return callback(null, null);
    }

    TaskReservationModel.baseModel.updateOne(
        { reservationId: reservationId, status: { $in: ['active', 'occupied'] } },
        { $set: { status: 'released', releasedAt: new Date(), expiresAt: null }, $unset: { lockKey: '' } },
        function (err, result) {
            return callback(err, result);
        }
    );
}

TaskReservationCtrl.releaseByTask = function (taskId, callback) {
    if (!taskId) {
        return callback(null, null);
    }

    TaskReservationModel.baseModel.updateOne(
        { taskId: String(taskId), status: { $in: ['active', 'occupied'] } },
        { $set: { status: 'released', releasedAt: new Date(), expiresAt: null }, $unset: { lockKey: '' } },
        function (err, result) {
            return callback(err, result);
        }
    );
}

TaskReservationCtrl.getActiveTaskPredictionMetadata = function (tasks, reservations, callback) {
    var metadataByTaskId = {};
    var reservationById = {};
    (reservations || []).forEach(function (reservation) {
        if (reservation && reservation.reservationId) {
            reservationById[String(reservation.reservationId)] = reservation;
        }
    });

    var decisionIds = [];
    var taskIds = [];
    (tasks || []).forEach(function (task) {
        var taskId = String(task._id);
        var reservation = task.t_reservationId
            ? reservationById[String(task.t_reservationId)]
            : null;
        if (reservation) {
            metadataByTaskId[taskId] = {
                rawPredictedDuration: reservation.rawPredictedDuration,
                predictedDuration: reservation.predictedDuration,
                calibrationFactor: reservation.calibrationFactor,
                source: 'task_reservation'
            };
            return;
        }
        taskIds.push(taskId);
        if (task.t_decisionId) {
            decisionIds.push(String(task.t_decisionId));
        }
    });

    if (decisionIds.length === 0 && taskIds.length === 0) {
        return callback(null, metadataByTaskId);
    }
    ScheduleDecisionModel.baseModel.find({
        $or: [
            { decisionId: { $in: decisionIds } },
            { taskId: { $in: taskIds } }
        ]
    }).lean().exec(function (err, decisions) {
        if (err) {
            console.warn('Schedule decision prediction lookup failed; using default workload duration:', err.message || err);
            return callback(null, metadataByTaskId);
        }
        var decisionById = {};
        var decisionByTaskId = {};
        (decisions || []).forEach(function (decision) {
            if (decision.decisionId) {
                decisionById[String(decision.decisionId)] = decision;
            }
            if (decision.taskId) {
                decisionByTaskId[String(decision.taskId)] = decision;
            }
        });
        (tasks || []).forEach(function (task) {
            var taskId = String(task._id);
            if (metadataByTaskId[taskId]) {
                return;
            }
            var decision = (task.t_decisionId && decisionById[String(task.t_decisionId)]) ||
                decisionByTaskId[taskId];
            if (decision) {
                metadataByTaskId[taskId] = {
                    rawPredictedDuration: decision.selectedRawPredictedDuration,
                    predictedDuration: decision.selectedPredictedDuration,
                    calibrationFactor: decision.predictionCalibrationFactor,
                    source: 'schedule_decision'
                };
            }
        });
        return callback(null, metadataByTaskId);
    });
}

TaskReservationCtrl.getServerLoad = function (serverIds, callback) {
    var stats = {};
    var ids = (serverIds || []).map(function (id) { return String(id); });
    var queryServerIds = (serverIds || []).concat(ids);

    var createEmptyStats = function () {
        return {
            activeReservationCount: 0,
            occupiedReservationCount: 0,
            occupiedInitedCount: 0,
            occupiedStartedCount: 0,
            pendingActiveReservationCount: 0,
            dbInitedTaskCount: 0,
            dbStartedTaskCount: 0,
            notYetRunningReservedIns: 0,
            unreservedActiveTaskCount: 0,
            reservationBackedTaskCount: 0,
            activeTasks: [],
            pendingReservations: [],
            staleOccupiedReleasedCount: 0
        };
    };

    ids.forEach(function (id) {
        stats[id] = createEmptyStats();
    });

    if (ids.length === 0) {
        return callback(null, stats);
    }

    TaskReservationCtrl.expireStale(function (expireErr) {
        if (expireErr) {
            return callback(expireErr);
        }

        TaskReservationModel.baseModel.find({
            serverId: { $in: ids },
            status: { $in: ['active', 'occupied'] }
        }).lean().exec(function (err, reservations) {
            if (err) {
                return callback(err);
            }

            var occupiedTaskIds = (reservations || []).filter(function (reservation) {
                return reservation.status === 'occupied' && reservation.taskId;
            }).map(function (reservation) { return String(reservation.taskId); });

            TaskModel.baseModel.find({
                $or: [
                    { _id: { $in: occupiedTaskIds } },
                    { t_server: { $in: queryServerIds }, t_status: { $in: ['Inited', 'Started'] } }
                ]
            }).lean().exec(function (taskErr, tasks) {
                if (taskErr) {
                    return callback(taskErr);
                }

                TaskReservationCtrl.getActiveTaskPredictionMetadata(tasks, reservations, function (metadataErr, predictionByTaskId) {
                    if (metadataErr) {
                        return callback(metadataErr);
                    }

                var taskById = {};
                var activeTasks = [];
                (tasks || []).forEach(function (task) {
                    taskById[String(task._id)] = task;
                    if (task.t_status === 'Inited' || task.t_status === 'Started') {
                        activeTasks.push(task);
                    }
                });

                var staleReservationIds = (reservations || []).filter(function (reservation) {
                    if (reservation.status !== 'occupied') {
                        return false;
                    }
                    if (!reservation.taskId) {
                        return true;
                    }
                    var linkedTask = taskById[String(reservation.taskId)];
                    return !linkedTask || ['Inited', 'Started'].indexOf(linkedTask.t_status) < 0;
                }).map(function (reservation) { return reservation.reservationId; });
                var staleByServer = {};
                (reservations || []).forEach(function (reservation) {
                    if (staleReservationIds.indexOf(reservation.reservationId) >= 0) {
                        var staleServerId = String(reservation.serverId);
                        staleByServer[staleServerId] = (staleByServer[staleServerId] || 0) + 1;
                    }
                });

                var finalizeStats = function (cleanupErr) {
                    if (cleanupErr) {
                        return callback(cleanupErr);
                    }
                    var staleMap = {};
                    staleReservationIds.forEach(function (reservationId) { staleMap[String(reservationId)] = true; });
                    var liveReservations = (reservations || []).filter(function (reservation) {
                        return !staleMap[String(reservation.reservationId)];
                    });
                    var liveReservationIds = {};
                    liveReservations.forEach(function (reservation) {
                        liveReservationIds[String(reservation.reservationId)] = true;
                    });
                    var taskReservationIds = {};
                    activeTasks.forEach(function (task) {
                        if (task.t_reservationId) {
                            taskReservationIds[String(task.t_reservationId)] = true;
                        }
                    });

                    activeTasks.forEach(function (task) {
                        var serverId = String(task.t_server);
                        var predictionMetadata = predictionByTaskId[String(task._id)] || {};
                        if (!stats[serverId]) {
                            stats[serverId] = createEmptyStats();
                        }
                        var item = {
                            taskId: String(task._id),
                            pid: task.t_pid || '',
                            status: task.t_status,
                            queuedAt: task.t_enqueuedTime || task.t_datetime || null,
                            startedAt: task.t_startTime || null,
                            reservationId: task.t_reservationId || '',
                            rawPredictedDuration: predictionMetadata.rawPredictedDuration,
                            predictedDuration: predictionMetadata.predictedDuration,
                            calibrationFactor: predictionMetadata.calibrationFactor,
                            predictionSource: predictionMetadata.source || 'default'
                        };
                        stats[serverId].activeTasks.push(item);
                        if (task.t_status === 'Inited') {
                            stats[serverId].dbInitedTaskCount += 1;
                        } else {
                            stats[serverId].dbStartedTaskCount += 1;
                        }
                        if (task.t_reservationId && liveReservationIds[String(task.t_reservationId)]) {
                            stats[serverId].reservationBackedTaskCount += 1;
                        } else {
                            stats[serverId].unreservedActiveTaskCount += 1;
                        }
                    });

                    liveReservations.forEach(function (reservation) {
                        var serverId = String(reservation.serverId);
                        if (!stats[serverId]) {
                            stats[serverId] = createEmptyStats();
                        }
                        if (reservation.status === 'active') {
                            stats[serverId].activeReservationCount += 1;
                            if (!taskReservationIds[String(reservation.reservationId)]) {
                                stats[serverId].pendingActiveReservationCount += 1;
                                stats[serverId].pendingReservations.push({
                                    reservationId: reservation.reservationId,
                                    pid: reservation.pid || '',
                                    queuedAt: reservation.createdAt || null,
                                    rawPredictedDuration: reservation.rawPredictedDuration,
                                    predictedDuration: reservation.predictedDuration,
                                    calibrationFactor: reservation.calibrationFactor
                                });
                            }
                        } else if (reservation.status === 'occupied') {
                            stats[serverId].occupiedReservationCount += 1;
                            var linkedTask = taskById[String(reservation.taskId)];
                            if (linkedTask && linkedTask.t_status === 'Inited') {
                                stats[serverId].occupiedInitedCount += 1;
                            } else if (linkedTask && linkedTask.t_status === 'Started') {
                                stats[serverId].occupiedStartedCount += 1;
                            }
                        }
                    });

                    ids.forEach(function (serverId) {
                        stats[serverId].notYetRunningReservedIns =
                            stats[serverId].dbInitedTaskCount + stats[serverId].pendingActiveReservationCount;
                        stats[serverId].staleOccupiedReleasedCount = staleByServer[serverId] || 0;
                    });
                    return callback(null, stats);
                };

                if (staleReservationIds.length === 0) {
                    return finalizeStats(null);
                }
                TaskReservationModel.baseModel.updateMany(
                    { reservationId: { $in: staleReservationIds }, status: 'occupied' },
                    { $set: { status: 'released', releasedAt: new Date(), expiresAt: null }, $unset: { lockKey: '' } },
                    finalizeStats
                );
                });
            });
        });
    });
}
