/**
 * Author: Fengyuan(Franklin) Zhang
 * Date: 2018/12/25
 * Update : 2025/7/16(wanwan)
 * Description: (ho ho ho) Router for model service API
 */
var formidable = require('formidable');
var serviceServer = require('modelservicesdk');
var TaskCtrl = require('../../controls/task');
var ServersCtrl = require('../../controls/servers');
var TaskReservationCtrl = require('../../controls/taskReservation');
var ScheduleDecisionCtrl = require('../../controls/scheduleDecision');
var CommonMethod = require('../../utils/commonMethod');
var Setting = require('../../setting');
var request = require('request');
const fs = require('fs');
const path = require('path');
const uuidv4 = require('uuid/v4');

function endJson(res, payload) {
    return res.end(JSON.stringify(payload));
}

function finalizeDecisionTrace(scoreResult, outcomePatch, reservationAttempts, reservationFailureCount) {
    if (!scoreResult || !scoreResult.decisionTrace) {
        return null;
    }
    var trace = scoreResult.decisionTrace;
    trace.outcome = Object.assign({}, trace.outcome || {}, outcomePatch || {});
    trace.reservation = {
        attempts: (reservationAttempts || []).map(function (attempt) {
            return Object.assign({}, attempt);
        }),
        failureCount: reservationFailureCount || 0
    };
    return trace;
}

module.exports = function (app) {
    app.route('/task/rescheduling')
        .get(function (req, res, next) {
            TaskCtrl.reschedulingFunction2();
            res.end("ok");
        });

    app.route('/task/testUpdateStatus')
        .get(function (req, res, next) {

            var taskid = "627771217484482bc42218b1";

            //主动请求manager server的更新任务状态接口 更新manager server task表的状态
            var url = "http://" + Setting.manager.website + "/GeoModeling/task/updateRunTask/" + taskid + "?status=Error";
            request.get(url, function (err, data) {
                if (err){
                    console.log("update manager server runTask status error");
                    res.end("error");
                }
                // {"code":1,"msg":"suc","data":null}
                console.log("update manager server runTask status successfully")

                res.end("ok");

            });

        });

    // 创建新任务并直接分配到具体的最优的服务器
    app.route('/task/schedule')
        .post(function (req, res, next) {
            // 解析请求体中的任务数据
            var taskData = TaskCtrl.buildTaskPayload(req.body);
            var pid = taskData.pid;
            var scheduleStartMs = Date.now();
            var scheduleStartTime = new Date(scheduleStartMs);
            var contextStartMs = Date.now();
            var schedulePolicy = ServersCtrl.normalizeSchedulePolicy ? ServersCtrl.normalizeSchedulePolicy(taskData.schedulePolicy) : (taskData.schedulePolicy || 'OURS_LLM');
            var experimentGroup = taskData.experimentGroup || '';
            var reservationEnabled = taskData.reservationEnabled !== false && taskData.reservationEnabled !== 'false';

            if (!pid) {
                return endJson(res, {
                    result: 'err',
                    code: -3,
                    message: 'No task info!',
                    data: ''
                });
            }

            // 构造调度上下文
            ServersCtrl.buildSchedulingContext(pid, taskData.inputs, {}, function (contextErr, context) {
                if (contextErr) {
                    var inputErrorDecisionId = uuidv4();
                    ScheduleDecisionCtrl.upsertByDecisionId(inputErrorDecisionId, {
                        status: 'input_error',
                        requestId: taskData.requestId || '',
                        pid: pid,
                        username: taskData.username || '',
                        schedulePolicy: schedulePolicy,
                        experimentGroup: experimentGroup,
                        reservationEnabled: reservationEnabled,
                        scheduleStartTime: scheduleStartTime,
                        scheduleEndTime: new Date(),
                        totalScheduleMs: Date.now() - scheduleStartMs,
                        contextBuildMs: Date.now() - contextStartMs,
                        inputValidation: {
                            valid: false,
                            message: contextErr.message
                        },
                        errorMessage: contextErr.message
                    }, function (logErr) {
                        if (logErr) {
                            console.error('Saving input_error schedule decision failed: ', logErr);
                        }
                    });
                    return endJson(res, {
                        result: 'err',
                        code: -1,
                        message: contextErr.message,
                        data: {
                            decisionId: inputErrorDecisionId
                        }
                    });
                }
                if (!context || !context.servers || context.servers.length === 0) {
                    return endJson(res, {
                        result: 'err',
                        code: -6,
                        message: 'No available server supports this task type!',
                        data: ''
                    });
                }

                taskData.inputs = context.inputs;
                var contextBuildMs = Date.now() - contextStartMs;

                // 对可用服务器进行评分和排序，选择最优的服务器进行任务分配
                ServersCtrl.scoreSchedulingContext(context, {
                    schedulePolicy: schedulePolicy,
                    experimentGroup: experimentGroup,
                    reservationEnabled: reservationEnabled,
                    scheduleStartTime: scheduleStartTime,
                    contextBuildMs: contextBuildMs
                }, function (scoreErr, scoreResult) {
                    if (scoreErr) {
                        return endJson(res, {
                            result: 'err',
                            code: -7,
                            message: scoreErr.message,
                            data: {
                                decisionId: scoreErr.decisionId || '',
                                decisionTrace: scoreErr.decisionTrace || null
                            }
                        });
                    }

                    var rankedServers = scoreResult.servers || [];
                    var reservationAttempts = [];
                    var reservationFailureCount = 0;
                    var reservationStartMs = Date.now();

                    var finishWithNoServer = function () {
                        var scheduleEndTime = new Date();
                        var totalScheduleMs = Date.now() - scheduleStartMs;
                        var failedDecisionTrace = finalizeDecisionTrace(scoreResult, {
                            selectedServerId: null,
                            schedulingSucceeded: false,
                            status: 'reservation_failed'
                        }, reservationAttempts, reservationFailureCount);
                        ScheduleDecisionCtrl.upsertByDecisionId(scoreResult.decisionId, {
                            status: 'reservation_failed',
                            scheduleEndTime: scheduleEndTime,
                            totalScheduleMs: totalScheduleMs,
                            reservationMs: Date.now() - reservationStartMs,
                            reservationAttempts: reservationAttempts,
                            reservationFailureCount: reservationFailureCount,
                            decisionTrace: failedDecisionTrace
                        }, function () {});
                        return endJson(res, {
                            result: 'err',
                            code: -8,
                            message: 'No reservation slot available for ranked servers!',
                            data: {
                                decisionId: scoreResult.decisionId,
                                schedulePolicy: scoreResult.schedulePolicy,
                                experimentGroup: experimentGroup,
                                decisionMode: scoreResult.decisionMode,
                                fallback: scoreResult.fallback,
                                fallbackTriggered: scoreResult.fallbackTriggered,
                                fallbackStage: scoreResult.fallbackStage,
                                fallbackReason: scoreResult.fallbackReason,
                                repairTriggered: scoreResult.repairTriggered,
                                repairAttemptCount: scoreResult.repairAttemptCount,
                                localRepairTriggered: scoreResult.localRepairTriggered,
                                repairMode: scoreResult.repairMode,
                                outputRepairTriggered: scoreResult.outputRepairTriggered,
                                outputRepairAttemptCount: scoreResult.outputRepairAttemptCount,
                                providerRetryTriggered: scoreResult.providerRetryTriggered,
                                providerRetryCount: scoreResult.providerRetryCount,
                                llmCallCount: scoreResult.llmCallCount,
                                localFillCount: scoreResult.localFillCount,
                                llmAttemptCount: scoreResult.llmAttemptCount,
                                policyConfidence: scoreResult.policyConfidence,
                                policyEvidenceUsed: scoreResult.policyEvidenceUsed,
                                workloadPolicyEvidence: scoreResult.workloadPolicyEvidence,
                                currentWorkloadPolicyEvidence: scoreResult.currentWorkloadPolicyEvidence,
                                decisionTrace: failedDecisionTrace
                            }
                        });
                    };

                    var createOnSelectedServer = function (ranked, selectedServer, reservationId, reservationMs, slotGrantedTime) {
                        var dispatchStartMs = Date.now();
                        TaskCtrl.createAndDispatchTask(taskData, selectedServer, {
                            totalInputSize: context.totalInputSize,
                            decisionId: scoreResult.decisionId,
                            scheduleMode: scoreResult.decisionMode,
                            schedulePolicy: scoreResult.schedulePolicy,
                            experimentGroup: experimentGroup,
                            reservationEnabled: reservationEnabled,
                            enqueuedTime: scheduleStartTime,
                            slotGrantedTime: slotGrantedTime,
                            fallback: scoreResult.fallback,
                            fallbackReason: scoreResult.fallbackReason,
                            selectedScore: ranked.score,
                            selectedPredictedDuration: ranked.predictedDuration,
                            selectedRawPredictedDuration: ranked.rawPredictedDuration,
                            predictionCalibrationFactor: ranked.calibrationFactor,
                            predictionCalibrationSampleCount: ranked.calibrationSampleCount,
                            selectedEstimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                            selectedEstimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                            selectedEstimatedWaitMs: ranked.estimatedWaitMs,
                            selectedEstimatedCompletionMs: ranked.estimatedCompletionMs,
                            predictionConfidence: ranked.predictionConfidence,
                            predictionEvidenceSource: ranked.predictionEvidenceSource,
                            reservationId: reservationId || '',
                            dispatchFallbackServers: []
                        }, function (createErr, taskItem, actualServer) {
                            var dispatchMs = Date.now() - dispatchStartMs;
                            var scheduleEndTime = new Date();
                            var totalScheduleMs = Date.now() - scheduleStartMs;

                            if (createErr) {
                                var releaseAndReturn = function () {
                                    var createErrorTrace = finalizeDecisionTrace(scoreResult, {
                                        selectedServerId: String((actualServer || selectedServer)._id),
                                        schedulingSucceeded: false,
                                        status: 'task_create_error',
                                        errorMessage: createErr.message
                                    }, reservationAttempts, reservationFailureCount);
                                    ScheduleDecisionCtrl.upsertByDecisionId(scoreResult.decisionId, {
                                        status: 'task_create_error',
                                        scheduleEndTime: scheduleEndTime,
                                        totalScheduleMs: totalScheduleMs,
                                        reservationMs: reservationMs,
                                        dispatchMs: dispatchMs,
                                        reservationAttempts: reservationAttempts,
                                        reservationFailureCount: reservationFailureCount,
                                        errorMessage: createErr.message,
                                        decisionTrace: createErrorTrace
                                    }, function () {});
                                    return endJson(res, {
                                        result: 'err',
                                        code: -9,
                                        message: createErr.message,
                                        data: {
                                            decisionId: scoreResult.decisionId,
                                            reservationId: reservationId || '',
                                            decisionTrace: createErrorTrace
                                        }
                                    });
                                };
                                if (reservationId) {
                                    return TaskReservationCtrl.release(reservationId, releaseAndReturn);
                                }
                                return releaseAndReturn();
                            }

                            var finishSuccess = function () {
                                var selectedServerId = String((actualServer || selectedServer)._id);
                                var successDecisionTrace = finalizeDecisionTrace(scoreResult, {
                                        selectedServerId: selectedServerId,
                                        selectedScore: ranked.score,
                                        selectedPredictedDuration: ranked.predictedDuration,
                                        selectedRawPredictedDuration: ranked.rawPredictedDuration,
                                        selectedCalibratedPredictedDuration: ranked.predictedDuration,
                                        predictionCalibrationFactor: ranked.calibrationFactor,
                                        predictionCalibrationSampleCount: ranked.calibrationSampleCount,
                                        selectedEstimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                                        selectedEstimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                                        selectedEstimatedWaitMs: ranked.estimatedWaitMs,
                                        selectedEstimatedCompletionMs: ranked.estimatedCompletionMs,
                                        predictionConfidence: ranked.predictionConfidence,
                                        predictionEvidenceSource: ranked.predictionEvidenceSource,
                                    schedulingSucceeded: true,
                                    status: taskItem.t_status === 'Started' ? 'started' : 'task_created'
                                }, reservationAttempts, reservationFailureCount);
                                ScheduleDecisionCtrl.upsertByDecisionId(scoreResult.decisionId, {
                                    status: taskItem.t_status === 'Started' ? 'started' : 'task_created',
                                    scheduleEndTime: scheduleEndTime,
                                    totalScheduleMs: totalScheduleMs,
                                    reservationMs: reservationMs,
                                    dispatchMs: dispatchMs,
                                    reservationAttempts: reservationAttempts,
                                    reservationFailureCount: reservationFailureCount,
                                    selectedServerId: selectedServerId,
                                    selectedScore: ranked.score,
                                    selectedPredictedDuration: ranked.predictedDuration,
                                    selectedRawPredictedDuration: ranked.rawPredictedDuration,
                                    selectedCalibratedPredictedDuration: ranked.predictedDuration,
                                    predictionCalibrationFactor: ranked.calibrationFactor,
                                    predictionCalibrationSampleCount: ranked.calibrationSampleCount,
                                    selectedEstimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                                    selectedEstimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                                    selectedEstimatedWaitMs: ranked.estimatedWaitMs,
                                    selectedEstimatedCompletionMs: ranked.estimatedCompletionMs,
                                    predictionConfidence: ranked.predictionConfidence,
                                    predictionEvidenceSource: ranked.predictionEvidenceSource,
                                    reservationId: reservationId || '',
                                    taskId: String(taskItem._id),
                                    actualTaskStatus: taskItem.t_status || '',
                                    actualStartTime: taskItem.t_startTime || null,
                                    decisionTrace: successDecisionTrace
                                }, function () {});
                                return endJson(res, {
                                    result: 'suc',
                                    code: 1,
                                    message: '',
                                    data: {
                                        taskId: taskItem._id,
                                        selectedServer: {
                                            serverId: selectedServerId,
                                            serverIP: (actualServer || selectedServer).s_ip,
                                            score: ranked.score,
                                            predictedDuration: ranked.predictedDuration,
                                            rawPredictedDuration: ranked.rawPredictedDuration,
                                            calibratedPredictedDuration: ranked.predictedDuration,
                                            calibrationFactor: ranked.calibrationFactor,
                                            calibrationSampleCount: ranked.calibrationSampleCount,
                                            estimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                                            estimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                                            estimatedWaitMs: ranked.estimatedWaitMs,
                                            estimatedCompletionMs: ranked.estimatedCompletionMs,
                                            predictionConfidence: ranked.predictionConfidence,
                                            predictionEvidenceSource: ranked.predictionEvidenceSource,
                                            coldStart: ranked.coldStart
                                        },
                                        enqueuedTime: taskItem.t_enqueuedTime || null,
                                        slotGrantedTime: taskItem.t_slotGrantedTime || null,
                                        decisionId: scoreResult.decisionId,
                                        reservationId: reservationId || '',
                                        schedulePolicy: scoreResult.schedulePolicy,
                                        experimentGroup: experimentGroup,
                                        recentHistoryTaskCount: scoreResult.recentHistoryTaskCount,
                                        decisionMode: scoreResult.decisionMode,
                                        fallback: scoreResult.fallback,
                                        fallbackTriggered: scoreResult.fallbackTriggered,
                                        fallbackStage: scoreResult.fallbackStage,
                                        fallbackReason: scoreResult.fallbackReason,
                                        totalScheduleMs: totalScheduleMs,
                                        llmLatencyMs: scoreResult.llmLatencyMs,
                                        llmPromptTokens: scoreResult.llmPromptTokens,
                                        llmCompletionTokens: scoreResult.llmCompletionTokens,
                                        llmTotalTokens: scoreResult.llmTotalTokens,
                                        policyCache: scoreResult.policyCache || null,
                                        policyConfidence: scoreResult.policyConfidence,
                                        policyEvidenceUsed: scoreResult.policyEvidenceUsed,
                                        workloadPolicyEvidence: scoreResult.workloadPolicyEvidence,
                                        currentWorkloadPolicyEvidence: scoreResult.currentWorkloadPolicyEvidence,
                                        repairTriggered: scoreResult.repairTriggered,
                                        repairAttemptCount: scoreResult.repairAttemptCount,
                                        localRepairTriggered: scoreResult.localRepairTriggered,
                                        repairMode: scoreResult.repairMode,
                                        outputRepairTriggered: scoreResult.outputRepairTriggered,
                                        outputRepairAttemptCount: scoreResult.outputRepairAttemptCount,
                                        providerRetryTriggered: scoreResult.providerRetryTriggered,
                                        providerRetryCount: scoreResult.providerRetryCount,
                                        llmCallCount: scoreResult.llmCallCount,
                                        localFillCount: scoreResult.localFillCount,
                                        llmAttemptCount: scoreResult.llmAttemptCount,
                                        totalInputSize: context.totalInputSize,
                                        inputWarnings: context.inputWarnings,
                                        decisionTrace: successDecisionTrace
                                    }
                                });
                            };

                            if (reservationId) {
                                return TaskReservationCtrl.occupy(reservationId, taskItem._id, finishSuccess);
                            }
                            return finishSuccess();
                        });
                    };

                    var tryRankedServerWithExperimentLog = function (index) {
                        if (index >= rankedServers.length) {
                            return finishWithNoServer();
                        }

                        var ranked = rankedServers[index];
                        var selectedServer = context.servers.find(function (server) {
                            return String(server._id) === String(ranked.serverId);
                        });

                        if (!selectedServer) {
                            return tryRankedServerWithExperimentLog(index + 1);
                        }

                        if (!reservationEnabled) {
                            return createOnSelectedServer(ranked, selectedServer, '', 0, new Date());
                        }

                        TaskReservationCtrl.reserve({
                            serverId: selectedServer._id,
                            pid: pid,
                            decisionId: scoreResult.decisionId,
                            requestId: taskData.requestId || '',
                            maxSlots: ranked.maxServerSlots,
                            maxAdmissionSlots: ranked.maxAdmissionSlots,
                            observedUnreservedTaskCount: ranked.observedUnreservedTaskCount,
                            capacityOverflow: ranked.capacityOverflow,
                            rawPredictedDuration: ranked.rawPredictedDuration,
                            predictedDuration: ranked.predictedDuration,
                            calibrationFactor: ranked.calibrationFactor,
                            estimatedWaitMs: ranked.estimatedWaitMs,
                            estimatedCompletionMs: ranked.estimatedCompletionMs
                        }, function (reservationErr, reservation) {
                            if (reservationErr) {
                                reservationFailureCount++;
                                reservationAttempts.push({
                                    serverId: String(ranked.serverId),
                                    score: ranked.score,
                                    predictedDuration: ranked.predictedDuration,
                                    estimatedWaitMs: ranked.estimatedWaitMs,
                                    estimatedCompletionMs: ranked.estimatedCompletionMs,
                                    maxAdmissionSlots: ranked.maxAdmissionSlots,
                                    capacityOverflow: ranked.capacityOverflow,
                                    success: false,
                                    reason: reservationErr.message,
                                    timestamp: new Date()
                                });
                                ScheduleDecisionCtrl.upsertByDecisionId(scoreResult.decisionId, {
                                    reservationAttempts: reservationAttempts,
                                    reservationFailureCount: reservationFailureCount
                                }, function () {});
                                console.warn('Reservation failed for server ' + ranked.serverId + ': ' + reservationErr.message);
                                return tryRankedServerWithExperimentLog(index + 1);
                            }

                            reservationAttempts.push({
                                serverId: String(ranked.serverId),
                                score: ranked.score,
                                predictedDuration: ranked.predictedDuration,
                                estimatedWaitMs: ranked.estimatedWaitMs,
                                estimatedCompletionMs: ranked.estimatedCompletionMs,
                                maxAdmissionSlots: ranked.maxAdmissionSlots,
                                capacityOverflow: ranked.capacityOverflow,
                                success: true,
                                reason: '',
                                timestamp: new Date()
                            });
                            var reservationMs = Date.now() - reservationStartMs;

                            ScheduleDecisionCtrl.upsertByDecisionId(scoreResult.decisionId, {
                                status: 'reserved',
                                requestId: taskData.requestId || '',
                                pid: pid,
                                username: taskData.username || '',
                                schedulePolicy: scoreResult.schedulePolicy,
                                experimentGroup: experimentGroup,
                                reservationEnabled: reservationEnabled,
                                reservationId: reservation.reservationId,
                                selectedServerId: String(selectedServer._id),
                                selectedScore: ranked.score,
                                selectedPredictedDuration: ranked.predictedDuration,
                                selectedRawPredictedDuration: ranked.rawPredictedDuration,
                                selectedCalibratedPredictedDuration: ranked.predictedDuration,
                                predictionCalibrationFactor: ranked.calibrationFactor,
                                predictionCalibrationSampleCount: ranked.calibrationSampleCount,
                                selectedEstimatedStartupDelayMs: ranked.estimatedStartupDelayMs,
                                selectedEstimatedQueueWaitMs: ranked.estimatedQueueWaitMs,
                                selectedEstimatedWaitMs: ranked.estimatedWaitMs,
                                selectedEstimatedCompletionMs: ranked.estimatedCompletionMs,
                                predictionConfidence: ranked.predictionConfidence,
                                predictionEvidenceSource: ranked.predictionEvidenceSource,
                                reservationMs: reservationMs,
                                reservationAttempts: reservationAttempts,
                                reservationFailureCount: reservationFailureCount
                            }, function (logErr) {
                                if (logErr) {
                                    console.error('Update schedule decision reserved failed for decision ' + scoreResult.decisionId + ':', logErr);
                                }
                            });

                            return createOnSelectedServer(
                                ranked,
                                selectedServer,
                                reservation.reservationId,
                                reservationMs,
                                reservation.createdAt || new Date()
                            );
                        });
                    };

                    return tryRankedServerWithExperimentLog(0);

                });
            });
        });

    app.route('/task/assign')
        .post(function (req, res, next) {
            var taskData = TaskCtrl.buildTaskPayload(req.body);
            var pid = taskData.pid; // 模型的pid
            var serverId = taskData.serverId; // managerServer指定的modelServer

            // 验证任务数据
            if (!pid || !serverId) {
                return res.end(JSON.stringify({
                    result: 'err',
                    code: -3,
                    message: 'Missing task or server information!',
                    data: ''
                }));
            }

            // 获取指定的模型服务器
            ServersCtrl.getById(serverId, function (err, selectedServer) {
                if (err || !selectedServer) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -4,
                        message: 'Specified server not found!',
                        data: ''
                    }));
                }

                // 验证模型服务器是否支持该PID（即该模型）
                if (!ServersCtrl.supportsPid(selectedServer, pid)) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -5,
                        message: 'Specified server does not support this task type!',
                        data: ''
                    }));
                }
                return TaskCtrl.enrichInputsWithSize(taskData.inputs, function (sizeErr, inputResult) {
                    if (sizeErr) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -6,
                            message: sizeErr.message,
                            data: ''
                        }));
                    }

                    taskData.inputs = inputResult.inputs;
                    return TaskCtrl.createAndDispatchTask(taskData, selectedServer, {
                        totalInputSize: inputResult.totalInputSize,
                        scheduleMode: 'assigned',
                        dispatchFallbackServers: []
                    }, function (taskErr, taskItem) {
                        if (taskErr) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -3,
                                message: taskErr.message,
                                data: ''
                            }));
                        }
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: taskItem._id
                        }));
                    });
                });
                if (!taskData.inputs || taskData.inputs.length === 0) {
                    return createTask();
                }

                if (typeof taskData.inputs == 'string') {
                    taskData.inputs = JSON.parse(taskData.inputs);
                }

                if (typeof taskData.outputs == 'string') {
                    taskData.outputs = JSON.parse(taskData.outputs);
                }

                // 后续内容是创建任务并提供历史任务数据量
                // 为每个输入数据添加size字段并计算总和
                let totalInputSize = 0;
                let processedCount = 0;
                taskData.inputs.forEach(input => {
                    const inputUrl = TaskCtrl.getInputUrl(input);
                    if (!inputUrl) {
                        input.size = 0;
                        processedCount++;
                        return;
                    }

                    TaskCtrl.getFileSize(inputUrl, (err, size) => {
                        if (err) {
                            console.error(`Get filesize failed for input ${inputUrl}:`, err);
                            input.size = 0;
                        } else {
                            input.size = size;
                            totalInputSize += size;
                        }

                        processedCount++;
                        if (processedCount === taskData.inputs.length) {
                            createTask();
                        }
                    })
                });

                function createTask() {
                    // 创建任务对象
                    var task = {
                        t_msrid: '',
                        t_pid: pid,
                        t_server: selectedServer._id,
                        t_inputs: taskData.inputs,
                        t_outputs: taskData.outputs,
                        t_user: taskData.username,
                        t_status: 'Inited',
                        t_type: selectedServer.s_type,
                        t_note: '',
                        t_datetime: new Date(),
                        t_enqueuedTime: new Date(),
                        t_slotGrantedTime: new Date(),
                        t_startTime: null,
                        t_endTime: null,
                        t_totalInputSize: totalInputSize
                    };

                    // 保存任务到数据库
                    TaskCtrl.add(task, function (err, taskItem) {
                        if (err) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -2,
                                message: err.message,
                                data: ''
                            }));
                        }

                        // 组织任务参数
                        var taskinfo = {
                            "pid": pid,
                            "taskid": taskItem._id,
                            "inputs": JSON.stringify(taskData.inputs),
                            "username": taskData.username,
                            "ipport": selectedServer.s_ip + ':' + selectedServer.s_port,
                            "outputs": JSON.stringify(taskData.outputs)
                        }

                        // 如果是本地网络服务器，直接发送任务
                        if (selectedServer.s_type == 1) {
                            ServersCtrl.sendTask(selectedServer, taskinfo, [selectedServer], function (err, tdata) {
                                if (err) {
                                    return res.end(JSON.stringify({
                                        result: 'err',
                                        code: -3,
                                        message: err.message,
                                        data: ''
                                    }));
                                }

                                // 更新任务状态
                                taskItem.t_msrid = tdata.msrid;
                                taskItem.t_status = 'Started';
                                taskItem.t_startTime = new Date();

                                TaskCtrl.update(taskItem, function (err, data) {
                                    if (err) {
                                        return res.end(JSON.stringify({
                                            result: 'err',
                                            code: -4,
                                            message: err.message,
                                            data: ''
                                        }));
                                    }

                                    // 设置任务状态轮询
                                    var server = new serviceServer(tdata.server.s_ip, tdata.server.s_port);
                                    var access = server.getServiceAccess();
                                     access.getModelServiceRecordByID(tdata.msrid)
                                        .then(function (record) {
                                            if (!record) {
                                                console.error("Error: Record not found for msrid:", tdata.msrid);
                                                return;
                                            }

                                            var taskPolling = setInterval(() => {
                                                record.refresh()
                                                    .then(function () {
                                                        var status = record.getStatus();

                                                        if (status == 1) { // Finished
                                                            taskItem.t_status = 'Finished';
                                                            taskItem.t_endTime = new Date();
                                                            taskItem.t_duration = new Date(taskItem.t_endTime) - new Date(taskItem.t_startTime);
                                                            TaskCtrl.update(taskItem, function () {});
                                                            clearInterval(taskPolling);
                                                        }
                                                        else if (status == -1) { // Error
                                                            taskItem.t_status = 'Error';
                                                            taskItem.t_endTime = new Date();
                                                            taskItem.t_duration = new Date(taskItem.t_endTime) - new Date(taskItem.t_startTime);
                                                            TaskCtrl.update(taskItem, function () {});
                                                            clearInterval(taskPolling);
                                                        }
                                                    });
                                            }, 30000);

                                            // 保存轮询以便后续清理
                                            global.taskPolling.push({
                                                taskid: taskinfo.taskid,
                                                polling: taskPolling
                                            });
                                        });

                                    return res.end(JSON.stringify({
                                        result: 'suc',
                                        code: 1,
                                        message: '',
                                        data: taskItem._id
                                    }));
                                });
                            });
                        } else {
                            // 互联网服务器，直接返回任务ID
                            return res.end(JSON.stringify({
                                result: 'suc',
                                code: 1,
                                message: '',
                                data: taskItem._id
                            }));
                        }
                    });
                }
            });
        });

    // 原有的任务创建接口，用户或者manager server可以直接调用这个接口创建任务，系统会根据当前服务器的负载情况选择最优的服务器来运行任务
    app.route('/task')
        .post(function (req, res, next) {
            var taskData = TaskCtrl.buildTaskPayload(req.body);
            var pid = taskData.pid;
            if (pid == undefined || pid == null || pid == "") {
                return res.end(JSON.stringify({
                    result: 'err',
                    code: -3,
                    message: 'No task info!',
                    data: ''
                }));
            }

            ServersCtrl.getByPIDWithStatus(pid, true, function (err, servers) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                if (!servers || servers.length === 0) {
                    return res.end(JSON.stringify({
                        result: 'suc',
                        code: 1,
                        message: '',
                        data: false
                    }));
                }

                servers = CommonMethod.arrayReorder(servers);
                TaskCtrl.getAllInitedTasks(function (taskErr, tasks) {
                    if (taskErr) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -4,
                            message: 'Error in getting all inited tasks',
                            data: ''
                        }));
                    }

                    for (var i = 0; i < servers.length; i++) {
                        servers[i].initedTask = 0;
                    }
                    for (var j = 0; j < tasks.length; j++) {
                        for (var k = 0; k < servers.length; k++) {
                            if (String(tasks[j].t_server) == String(servers[k]._id)) {
                                servers[k].initedTask = servers[k].initedTask + 1;
                                break;
                            }
                        }
                    }

                    servers.sort(function (a, b) {
                        return a.initedTask - b.initedTask;
                    });

                    var server_s = servers.splice(0, 1)[0];
                    TaskCtrl.enrichInputsWithSize(taskData.inputs, function (sizeErr, inputResult) {
                        if (sizeErr) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -5,
                                message: sizeErr.message,
                                data: ''
                            }));
                        }

                        taskData.inputs = inputResult.inputs;
                        return TaskCtrl.createAndDispatchTask(taskData, server_s, {
                            totalInputSize: inputResult.totalInputSize,
                            scheduleMode: 'opengms-fixed-rule',
                            dispatchFallbackServers: servers
                        }, function (taskCreateErr, taskItem) {
                            if (taskCreateErr) {
                                return res.end(JSON.stringify({
                                    result: 'err',
                                    code: -3,
                                    message: taskCreateErr.message,
                                    data: ''
                                }));
                            }
                            return res.end(JSON.stringify({
                                result: 'suc',
                                code: 1,
                                message: '',
                                data: taskItem._id
                            }));
                        });
                    });
                });
            });
        });

    app.route('/task/:id')
        .get(function (req, res, next) {
            var taskid = req.params.id;
            if (!taskid || !/^[0-9a-fA-F]{24}$/.test(taskid)) {
                return res.end(JSON.stringify({
                    result: 'err',
                    code: -2,
                    message: 'Invalid task id',
                    data: ''
                }));
            }
            TaskCtrl.getByOID(taskid, function (err, task) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                if (!task) {
                    return res.end(JSON.stringify({
                        result: 'suc',
                        code: 0,
                        message: 'No such task',
                        data: ''
                    }));
                }
                return res.end(JSON.stringify({
                    result: 'suc',
                    code: 1,
                    message: '',
                    data: TaskCtrl.buildStatusPayload(task)
                }));
            });
        })
        .put(function (req, res, next) {
            var taskid = req.params.id;
            var req_status = 'Unknown';
            var req_note = "";
            if (req.body.t_note) {
                req_note = req.body.t_note;
            } else if (req.body.note) {
                req_note = req.body.note;
            } else if (req.body.message) {
                req_note = req.body.message;
            }
            try {
                req_status = parseInt(req.body.status);
            }
            catch (ex) {
                //! Error in parsing parameter
                return res.end(JSON.stringify({
                    result: 'err',
                    code: -1,
                    message: 'Parameter error!',
                    data: 'status'
                }));
            }
            //TODO 2020.01.05 by MW 因为模型容器错误返回了状态2 来代表Started状态，导致此处存在误解
            if (req_status == 2) {  //update model status to Started, Started: 2, Finished: 1, Inited: 0, Error: -1
                var msrid = 'Unknown';
                var req_msrlogs = [];
                var req_mlogs = [];
                try {
                    msrid = req.body.msrid;
                    if (req.body.msr_logs) {
                        req_msrlogs = JSON.parse(req.body.msr_logs);
                    }
                    if (req.body.m_logs) {
                        if (typeof req.body.m_logs === 'string') {
                            req_mlogs = req.body.m_logs.split('\n');
                        } else {
                            req_mlogs = req.body.m_logs;
                        }
                    }
                } catch (ex) {
                    //TODO Handle Error
                    console.log(ex);
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Parameter error!',
                        data: 'model_record_id or logs'
                    }));
                }
                TaskCtrl.getByOID(taskid, function (err, task) {
                    if (err) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -1,
                            message: err.message,
                            data: ''
                        }));
                    }
                    if (task == null) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -1,
                            message: 'No such task',
                            data: ''
                        }));
                    }
                    task.t_status = 'Started';
                    task.t_msrid = msrid;
                    task.t_msrlogs = req_msrlogs;
                    task.t_mlogs = req_mlogs;
                    task.t_startTime = new Date();
                    TaskCtrl.update(task, function (err, result) {
                        if (err) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -1,
                                message: err.message,
                                data: ''
                            }));
                        }

                        if (task.t_decisionId) {
                            ScheduleDecisionCtrl.upsertByDecisionId(task.t_decisionId, {
                                status: 'started',
                                taskId: String(task._id),
                                actualTaskStatus: 'Started',
                                actualStartTime: task.t_startTime || null,
                                reservationId: task.t_reservationId || ''
                            }, function (logErr) {
                                if (logErr) {
                                    console.error('Update schedule decision started failed for decision ' + task.t_decisionId + ':', logErr);
                                }
                            });
                        }

                        TaskCtrl.updateRunTask(taskid, task.t_status);

                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: 'change status success',
                            data: ''
                        }));
                    });
                });
            } else {
                var ip = CommonMethod.getIP(req);
                var mac = 'Unknown';
                var msrid = 'Unknown';
                try {
                    mac = req.body.mac;
                }
                catch (ex) {
                    //! Error in parsing parameter
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Parameter error!',
                        data: 'mac_address'
                    }));
                }
                var req_outputs = [];
                try {
                    req_outputs = req.body.outputs;
                }
                catch (ex) {
                    //! Error in parsing parameter
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Parameter error!',
                        data: 'output_data'
                    }));
                }
                // model running ID
                try {
                    msrid = req.body.msrid;
                } catch (ex) {
                    //! Error in parsing parameter
                    console.log(ex);
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Parameter error!',
                        data: 'model_record_id'
                    }));
                }
                // model running log
                var req_msrlogs = [];
                try {
                    req_msrlogs = req.body.msr_logs;
                }
                catch (ex) {
                    //! Error in parsing parameter
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Parameter error!',
                        data: 'msr_logs'
                    }));
                }
                // running model log
                var req_mlogs = [];
                try {
                    if (typeof req.body.m_logs === 'string') {
                        req_mlogs = req.body.m_logs.split('\n');
                    } else {
                        req_mlogs = req.body.m_logs;
                    }
                }
                catch (ex) {
                    //! Error in parsing parameter
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Parameter error!',
                        data: 'm_logs'
                    }));
                }

                ServersCtrl.checkIP(ip, mac, function (err, server) {
                    if (err) {
                        //! Error in parsing parameter
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -1,
                            message: 'Parameter error!',
                            data: 'mac_address'
                        }));
                    }
                    if (server == false) {
                        //! Error in get server
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -2,
                            message: 'Error in matching server: Can not find server record!',
                            data: ''
                        }));
                    }
                    else {
                        TaskCtrl.getByOID(taskid, function (err, task) {
                            if (err) {
                                //! Error in get server
                                return res.end(JSON.stringify({
                                    result: 'err',
                                    code: -2,
                                    message: 'Error in matching task record!',
                                    data: ''
                                }));
                            }
                            if (task == null) {
                                return res.end(JSON.stringify({
                                    result: 'err',
                                    code: -1,
                                    message: 'No such task',
                                    data: ''
                                }));
                            }
                            var status = 'Started';
                            if (req_status == 1) {
                                status = 'Finished';
                                if (req_outputs && typeof req_outputs === 'string') {
                                    try {
                                        task.t_outputs = JSON.parse(req_outputs);
                                    } catch (e) {
                                        console.error("Error parsing outputs:", e);
                                    }
                                }
                                if (req_msrlogs && typeof req_msrlogs === 'string') {
                                    try {
                                        task.t_msrlogs = JSON.parse(req_msrlogs);
                                    } catch (e) {
                                        console.error("Error parsing msr_logs:", e);
                                    }
                                }
                                if (req_mlogs) {
                                    if (typeof req_mlogs === 'string') {
                                        task.t_mlogs = req_mlogs.split('\n');
                                    } else {
                                        task.t_mlogs = req_mlogs;
                                    }
                                }

                                //输出地址统一转换成'geomodeling.njnu.edu.cn/dataTransferServer'
                                let outputs = task.t_outputs;
                                for (let i = 0; i < outputs.length; i++) {
                                    let url = outputs[i].Url
                                    if (url != null && url !== "") {
                                        // 把内网ip换成外网可以访问的地址，供外网下载
                                        url = url.replace("221.226.60.2:8082", Setting.dataContainerIpAndPort.website);
                                        url = url.replace("175.27.137.60:8082", Setting.dataContainerIpAndPort.website);
                                        outputs[i].Url = url;
                                    }
                                }
                                task.t_outputs = outputs;
                                task.t_endTime = new Date();
                                // 计算运行时长（毫秒）
                                if (task.t_startTime) {
                                    task.t_duration = new Date(task.t_endTime) - new Date(task.t_startTime);
                                }
                            }
                            else if (req_status == -1) {
                                task.t_note = req_note || TaskCtrl.buildWorkerErrorNote(req.body) || 'Model container reported Error';
                                status = 'Error';
                                // 更新日志信息
                                if (req_msrlogs && typeof req_msrlogs === 'string') {
                                    try {
                                        task.t_msrlogs = JSON.parse(req_msrlogs);
                                    } catch (e) {
                                        console.error("Error parsing msr_logs:", e);
                                    }
                                }
                                if (req_mlogs) {
                                    if (typeof req_mlogs === 'string') {
                                        task.t_mlogs = req_mlogs.split('\n');
                                    } else {
                                        task.t_mlogs = req_mlogs;
                                    }
                                }
                                task.t_endTime = new Date();
                                // 计算运行时长（毫秒）
                                if (task.t_startTime) {
                                    task.t_duration = new Date(task.t_endTime) - new Date(task.t_startTime);
                                }
                            } else if (req_status == 0) {
                                status = 'Inited';
                                if (msrid && msrid !== 'Unknown') {
                                    task.t_msrid = msrid;
                                }
                                if (req_msrlogs && typeof req_msrlogs === 'string') {
                                    try {
                                        task.t_msrlogs = JSON.parse(req_msrlogs);
                                    } catch (e) {
                                        console.error("Error parsing msr_logs:", e);
                                    }
                                }
                                if (req_mlogs) {
                                    if (typeof req_mlogs === 'string') {
                                        task.t_mlogs = req_mlogs.split('\n');
                                    } else {
                                        task.t_mlogs = req_mlogs;
                                    }
                                }
                            } else {
                                status = 'Error';
                                task.t_note = req_note || ('Unsupported task status from worker: ' + req_status);
                                task.t_endTime = new Date();
                                if (task.t_startTime) {
                                    task.t_duration = new Date(task.t_endTime) - new Date(task.t_startTime);
                                }
                            }
                            task.t_status = status;
                            TaskCtrl.update(task, function (err, result) {
                                if (err) {
                                    //! Error in updating task message
                                    return res.end(JSON.stringify({
                                        result: 'err',
                                        code: -3,
                                        message: err.message,
                                        data: ''
                                    }));
                                }

                                if (task.t_status === 'Finished' || task.t_status === 'Error') {
                                    TaskCtrl.markTerminal(task, task.t_status, task.t_note);
                                } else if (task.t_status === 'Started' && task.t_decisionId) {
                                    ScheduleDecisionCtrl.upsertByDecisionId(task.t_decisionId, {
                                        status: 'started',
                                        taskId: String(task._id),
                                        actualTaskStatus: 'Started',
                                        actualStartTime: task.t_startTime || null,
                                        reservationId: task.t_reservationId || ''
                                    }, function (logErr) {
                                        if (logErr) {
                                            console.error('Update schedule decision started failed for decision ' + task.t_decisionId + ':', logErr);
                                        }
                                    });
                                } else if (task.t_status === 'Inited' && task.t_decisionId) {
                                    ScheduleDecisionCtrl.upsertByDecisionId(task.t_decisionId, {
                                        status: 'inited',
                                        taskId: String(task._id),
                                        actualTaskStatus: 'Inited',
                                        reservationId: task.t_reservationId || ''
                                    }, function (logErr) {
                                        if (logErr) {
                                            console.error('Update schedule decision inited failed for decision ' + task.t_decisionId + ':', logErr);
                                        }
                                    });
                                }

                                TaskCtrl.updateRunTask(taskid, task.t_status);

                                return res.end(JSON.stringify({
                                    result: 'suc',
                                    code: 1,
                                    message: '',
                                    data: ''
                                }));
                            });
                            if (server.s_type == 1) {
                                for (var i = 0; i < global.taskPolling.length; i++) {
                                    if (task._id == global.taskPolling[i].taskid) {
                                        clearInterval(global.taskPolling[i].polling);
                                    }
                                }
                            }
                        });
                    }
                });
            }
        });

    //get the task list which should be invoked(Inited task, only get the task t_type = 2 )
    app.route('/task/inited/all')
        .get(function (req, res, next) {
            var mac = req.query.mac;
            var status = JSON.parse(decodeURIComponent(req.query.status));

            // 格式化CPU信息
            status.cpuInfo = status.cpuInfo;

            ServersCtrl.getByMac(mac, function (err, servers) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: []
                    }));
                }
                if (servers.length > 0) {
                    var server = servers[0];
                    var server_id = server._id;
                    server.s_datetime = new Date();
                    server.s_status = true;
                    server.s_hardware = status;

                    //! update the server time in order to judge the server connection status
                    ServersCtrl.update(server, function (err, result) {
                    });

                    TaskCtrl.getByServerAndInitdStatus(server_id, function (err, tasks) {
                        if (err) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -1,
                                message: err.message,
                                data: []
                            }));
                        }


                        //! reverse order the tasks

                        //! check the number of running instance, only send “suitable” number of tasks
                        //! current we only allow one computing has one running task
                        let allowTaskNum = (Setting.schedule && Setting.schedule.maxServerSlots);
                        if(tasks.length > 0){
                            if(status.runningIns == undefined){
                                console.log("Return " + allowTaskNum + " tasks (No running status got) - IP:[" + server.s_ip + "]");
                                return endJson(res, TaskCtrl.buildWorkerTaskResponse(tasks, allowTaskNum));
                            }
                            else if(status.runningIns == 0){
                                console.log("Return " + allowTaskNum + " tasks - IP:[" + server.s_ip + "]");
                                return endJson(res, TaskCtrl.buildWorkerTaskResponse(tasks, allowTaskNum));
                            }
                            else if(status.runningIns > 0 && status.runningIns < allowTaskNum){
                                console.log("Return " + (allowTaskNum - status.runningIns).toString() + " tasks (" + status.runningIns.toString() + " instances are running in the container) - IP:[" + server.s_ip + "]");
                                return endJson(res, TaskCtrl.buildWorkerTaskResponse(tasks, allowTaskNum - status.runningIns));
                            }
                            else if(status.runningIns > allowTaskNum - 1){
                                console.log("None task returned!(" + allowTaskNum + " instances are running in the container) - IP:[" + server.s_ip + "]");
                                return res.end(JSON.stringify({
                                    result: 'suc',
                                    code: 1,
                                    message: '',
                                    data: []
                                }));
                            }
                        }
                        else{
                            console.log("None task returned!");
                            return res.end(JSON.stringify({
                                result: 'suc',
                                code: 1,
                                message: '',
                                data: []
                            }));
                        }
                        
                    })

                } else {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'Database error, no such record',
                        data: []
                    }));
                }
            })
        })

    // 根据sid将模型运算任务分发到特定的模型容器上进行运算
    app.route('/task/invoke/:sid')
        .post(function (req, res, next) {
            var sid = req.params.sid;
            var taskData = TaskCtrl.buildTaskPayload(req.body);
            ServersCtrl.getByOID(sid, function (err, server) {
                if (err) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: err.message,
                        data: ''
                    }));
                }
                if (server == null) {
                    return res.end(JSON.stringify({
                        result: 'err',
                        code: -1,
                        message: 'no this computer resource',
                        data: ''
                    }));
                }

                return TaskCtrl.enrichInputsWithSize(taskData.inputs, function (sizeErr, inputResult) {
                    if (sizeErr) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -2,
                            message: sizeErr.message,
                            data: ''
                        }));
                    }
                    taskData.inputs = inputResult.inputs;
                    return TaskCtrl.createAndDispatchTask(taskData, server, {
                        totalInputSize: inputResult.totalInputSize,
                        scheduleMode: 'manual-invoke',
                        dispatchFallbackServers: []
                    }, function (taskErr, taskItem) {
                        if (taskErr) {
                            return res.end(JSON.stringify({
                                result: 'err',
                                code: -3,
                                message: taskErr.message,
                                data: ''
                            }));
                        }
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: taskItem._id
                        }));
                    });
                });

                if (typeof taskData.inputs == 'string') {
                    taskData.inputs = JSON.parse(taskData.inputs);
                }

                if (typeof taskData.outputs == 'string') {
                    taskData.outputs = JSON.parse(taskData.outputs);
                }

                var task = {
                    t_msrid: '',
                    t_pid: taskData.pid,
                    t_server: server._id,
                    t_inputs: taskData.inputs,
                    t_outputs: taskData.outputs,
                    t_user: taskData.username,
                    t_status: 'Inited',
                    t_type: server.s_type,
                    t_note: '',
                    t_datetime: new Date(),
                    t_enqueuedTime: new Date(),
                    t_slotGrantedTime: new Date()
                };

                TaskCtrl.add(task, function (err, taskItem) {
                    if (err) {
                        return res.end(JSON.stringify({
                            result: 'err',
                            code: -2,
                            message: err.message,
                            data: ''
                        }));
                    }
                    //! organize parameter
                    var taskinfo = {
                        "pid": taskData.pid,
                        "taskid": taskItem._id,
                        "inputs": JSON.stringify(taskData.inputs),
                        "username": taskData.username,
                        "ipport": server.s_ip + ':' + server.s_port,
                        "outputs": JSON.stringify(taskData.outputs)
                    }
                    if (server.s_type == 1) {
                        ServersCtrl.sendTask(server, taskinfo, [], function (err, tdata) {
                            //不需要做任何操作
                            if (err) {
                                console.log(err);
                            }
                            console.log(tdata);
                        });
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: taskItem._id
                        }));
                    } else {
                        //Internet 
                        return res.end(JSON.stringify({
                            result: 'suc',
                            code: 1,
                            message: '',
                            data: taskItem._id
                        }));
                    }
                });

            })
        })

    app.route("/test")
        .get((req, res, next) => {

            // for (let i = 0; i < 100; i++) {
            //     console.log(Math.round(Math.random()*10));
            // }


            TaskCtrl.reschedulingFunction2();
            return res.end(JSON.stringify({
                result: 'suc',
                code: 1,
                message: '',
                data: ''
            }));


            // var time1 = new Date("2021-9-16");
            // setInterval(() => {
            //     var time2 = new Date();
            //     var interval = time2 - time1;
            //     return res.end(JSON.stringify({
            //         result: 'suc',
            //         code: 1,
            //         message: '',
            //         data: (interval / 1000 / 60) > (23 * 60)
            //     }));
            // },500);




    });

}
