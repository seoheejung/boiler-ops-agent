import hashlib
import json
import math
import os
from datetime import datetime
from pathlib import Path
from statistics import linear_regression, mean

from backend.app.config import Settings
from backend.app.replay.csv_source import rows

TARGET = "최종재열기 입구 온도 평균값"
HORIZON = 5


def metrics(pairs, predict):
    errors = [predict(x) - y for x, y in pairs]
    if not errors:
        raise ValueError("No evaluation pairs")
    return {"samples": len(errors), "mae": mean(abs(error) for error in errors),
            "rmse": math.sqrt(mean(error * error for error in errors))}


def train():
    settings = Settings.load()
    observations = []
    for _, source_time, measurements in rows(settings):
        raw = measurements[TARGET]
        try:
            value = float(raw)
            if not math.isfinite(value):
                value = None
        except ValueError:
            value = None
        observations.append((datetime.fromisoformat(source_time), value))
    n = len(observations)
    train_end, valid_end = int(n * .7), int(n * .85)
    if train_end < 100 or n - valid_end < 30:
        raise ValueError("Insufficient chronological data for forecasting")

    def pairs(start, end):
        result = []
        for i in range(start, end - HORIZON):
            time, x = observations[i]
            future_time, y = observations[i + HORIZON]
            if x is not None and y is not None and (future_time - time).total_seconds() == HORIZON * 60:
                result.append((x, y))
        return result

    training, validation, testing = pairs(0, train_end), pairs(train_end, valid_end), pairs(valid_end, n)
    slope, intercept = linear_regression([x for x, _ in training], [y for _, y in training])
    predictors = {"naive": lambda x: x, "linear_ar": lambda x: intercept + slope * x}
    validation_metrics = {name: metrics(validation, predict) for name, predict in predictors.items()}
    selected = min(validation_metrics, key=lambda name: validation_metrics[name]["mae"])
    with settings.dataset.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    report = {"version": 1, "target": TARGET, "horizon_minutes": HORIZON, "dataset_sha256": digest,
              "row_count": n, "train_samples": len(training), "slope": slope, "intercept": intercept,
              "selection_rule": "minimum validation MAE", "selected": selected,
              "train_end_time": observations[train_end - 1][0].isoformat(),
              "validation_end_time": observations[valid_end - 1][0].isoformat(),
              "test_start_time": observations[valid_end][0].isoformat(), "test_start_row": valid_end + 1,
              "test_end_time": observations[-1][0].isoformat(), "validation": validation_metrics,
              "test": {name: metrics(testing, predict) for name, predict in predictors.items()},
              "limitations": ["단위 미확인", "단일 설비·기간의 시간순 holdout", "제어 인과관계 미확인", "목표 온도 결측"]}
    path = Path(os.getenv("FORECAST_MODEL_PATH", "artifacts/models/reheater.json"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return report


if __name__ == '__main__':
    print(json.dumps(train(), ensure_ascii=False))
