import json
import math
import os
from datetime import datetime, timedelta
from pathlib import Path


def forecast(state):
    path = Path(os.getenv("FORECAST_MODEL_PATH", "artifacts/models/reheater.json"))
    if not path.is_file():
        raise ValueError("Forecast model not trained; run python -m backend.app.forecast.train")
    model = json.loads(path.read_text(encoding='utf-8'))
    if not state.current:
        raise ValueError("No telemetry available for forecast")
    target = model["target"]
    reading = state.current["sensors"].get(target)
    if reading is None or reading["value"] is None:
        raise ValueError("Forecast input is missing or invalid")
    source = datetime.fromisoformat(state.current["source_time"])
    if source <= datetime.fromisoformat(model["validation_end_time"]):
        raise ValueError("Forecast requires source_time after the model validation cutoff to avoid leakage")
    value = reading["value"]
    predictions = {"naive": value, "linear_ar": model["intercept"] + model["slope"] * value}
    if not all(math.isfinite(value) for value in predictions.values()):
        raise ValueError("Forecast produced a non-finite value")
    return {"target": target, "equipment": "reheater", "source_time": state.current["source_time"],
            "forecast_time": (source + timedelta(minutes=model["horizon_minutes"])).isoformat(),
            "horizon_minutes": model["horizon_minutes"], "input_value": value,
            "prediction": predictions[model["selected"]], "selected_model": model["selected"],
            "predictions": predictions, "validation": model["validation"], "test": model["test"],
            "training_cutoff": model["train_end_time"], "validation_cutoff": model["validation_end_time"],
            "dataset_sha256": model["dataset_sha256"], "status": state.snapshot()["status"],
            "beats_naive_on_test": model["test"][model["selected"]]["mae"] < model["test"]["naive"]["mae"],
            "advisory": "예측은 관측 추세의 참고 정보입니다. 목표 온도와 제어 효과 근거를 확인하기 전 제어값 변경을 권고하지 않습니다.",
            "limitations": model["limitations"]}
