from datetime import datetime
from statistics import mean, stdev

LOOPS = {
    "reheater": {"actual": "최종재열기 입구 온도 평균값", "target": "목표 재열기 온도",
                 "controls": ["재열기 스프레이 유량", "재열기 과열저감기1 스프레이 밸브 개도", "재열증기 온도(틸트) 제어"]},
    "generation": {"actual": "실제 출력값", "target": "목표 발전량", "controls": ["석탄 유량 제어", "총 공기 유량"]},
}


def sensor_summary(state, tag):
    if tag not in state.registry:
        raise ValueError(f"Unknown tag: {tag}")
    events = list(state.history)
    value = state.current["sensors"][tag]["value"] if state.current else None
    baseline = [event["sensors"][tag]["value"] for event in events[:-1] if event["sensors"][tag]["value"] is not None]
    average = mean(baseline) if baseline else None
    deviation = stdev(baseline) if len(baseline) > 1 else None
    rate = None
    if len(events) > 1 and value is not None:
        previous = events[-2]["sensors"][tag]["value"]
        minutes = (datetime.fromisoformat(events[-1]["source_time"]) - datetime.fromisoformat(events[-2]["source_time"])).total_seconds() / 60
        if previous is not None and minutes > 0:
            rate = (value - previous) / minutes
    return {"tag": tag, "current": value, "source_time": state.current["source_time"] if state.current else None,
            "rate_per_source_minute": rate, "baseline_count": len(baseline), "baseline_mean": average,
            "baseline_stddev": deviation, "z_score": (value - average) / deviation if value is not None and deviation else None,
            "interpretation": "Observed historical distribution, not an industrial safety threshold"}


def loop_analysis(state, name, limit=120):
    if name not in LOOPS:
        raise ValueError(f"Unknown loop: {name}")
    loop = LOOPS[name]
    tags = [loop["actual"], loop["target"], *loop["controls"]]
    points = []
    for event in list(state.history)[-limit:]:
        values = {tag: event["sensors"].get(tag, {}).get("value") for tag in tags}
        actual, target = values[loop["actual"]], values[loop["target"]]
        points.append({"sequence": event["sequence"], "source_time": event["source_time"], "values": values,
                       "actual_minus_target": actual - target if actual is not None and target is not None else None})
    return {"loop": name, **loop, "points": points, "summary": sensor_summary(state, loop["actual"]),
            "target_available": bool(points) and points[-1]["values"][loop["target"]] is not None,
            "status": state.snapshot()["status"], "note": "관측 입력값 비교. 제어 인과관계 및 산업 안전 판정 미확인."}
