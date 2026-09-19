import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "static" / "runMultipleTimes.py"
SPEC = importlib.util.spec_from_file_location("run_multiple_times", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def main():
    trace = {
        "schemaVersion": 4,
        "finalLoadSnapshot": [{"serverId": "a", "runningTaskCount": 1}],
        "scoring": {
            "durationFormula": "100 * fastestCandidateEstimatedCompletionMs / estimatedCompletionMs",
            "rankedServers": [{"serverId": "a", "estimatedCompletionMs": 200}],
        },
    }
    schedule_data = {"decisionId": "decision-1", "taskId": "task-1", "decisionTrace": trace}
    schedule_response = {"code": 1, "data": {"decisionId": "decision-1", "decisionTrace": trace}}

    extracted = MODULE.pop_decision_trace(schedule_data, schedule_response)
    assert extracted == trace
    assert "decisionTrace" not in schedule_data
    assert MODULE.get_response_decision_id(schedule_data, schedule_response) == "decision-1"

    stdout = "\n".join([
        "normal log",
        "taskServer schedule res: {'data': {'decisionTrace': {}}}",
        MODULE.SCHEDULE_JSON_PREFIX + '{"decisionTrace": {}}',
        "another log",
    ])
    sanitized = MODULE.sanitize_stored_stdout(stdout)
    assert sanitized == "normal log\nanother log"

    failed_data = None
    failed_response = {"code": -8, "data": {"decisionId": "decision-2", "decisionTrace": trace}}
    assert MODULE.pop_decision_trace(failed_data, failed_response) == trace
    assert MODULE.get_response_decision_id(failed_data, failed_response) == "decision-2"

    report = MODULE.build_final_report([{
        "taskId": "task-1",
        "scheduleData": {
            "llmCallCount": 1,
            "repairTriggered": False,
            "localFillCount": 0,
            "llmLatencyMs": 100,
            "llmPromptTokens": 20,
            "llmCompletionTokens": 10,
            "selectedServer": {
                "predictedDuration": 1000,
                "estimatedQueueWaitMs": 400,
                "estimatedCompletionMs": 1500,
                "coldStart": True,
            },
        },
        "decisionTrace": {
            "scoring": {
                "rankedServers": [
                    {"estimatedCompletionMs": 1200},
                    {"estimatedCompletionMs": 1500},
                ]
            }
        },
    }], [{
        "taskId": "task-1",
        "success": True,
        "actualQueueWaitMs": 500,
        "actualServiceTimeMs": 1250,
    }])
    assert report["schemaVersion"] == 4
    assert report["schemaFirstPassRate"] == 1
    assert report["queueWaitPrediction"]["medianAbsoluteErrorMs"] == 100
    assert report["serviceTimePrediction"]["MdAPE"] == 0.2
    assert report["schedulingRegret"]["medianMs"] == 300
    assert report["coldStart"]["successRate"] == 1
    print("Experiment decision trace tests passed.")


if __name__ == "__main__":
    main()
