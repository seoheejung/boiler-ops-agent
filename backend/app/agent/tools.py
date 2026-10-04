from types import SimpleNamespace

from backend.app.domain.analysis import sensor_summary
from backend.app.forecast.service import forecast

TOOL_NAMES = ("get_boiler_status", "get_equipment_status", "get_sensor_history", "get_operating_targets", "get_current_controls", "get_deviation_summary", "get_temperature_forecast")


class ReadTools:
    def __init__(self, state, equipment, tag=None):
        equipment_ids = {sensor["equipment"] for sensor in state.registry.values()}
        if equipment not in equipment_ids:
            raise ValueError("Unknown equipment")
        self.tags = [key for key, sensor in state.registry.items() if sensor["equipment"] == equipment]
        if tag is not None and tag not in self.tags:
            raise ValueError("Tag is unknown or outside selected equipment")
        self.equipment = equipment
        self.tag = tag or self.tags[0]
        self.snapshot = state.snapshot()
        self.state = SimpleNamespace(registry=state.registry, current=state.current, history=tuple(state.history), snapshot=lambda: self.snapshot)

    def call(self, name):
        if name not in TOOL_NAMES:
            raise ValueError("Tool is not in the read allowlist")
        if name == "get_boiler_status":
            return {key: self.snapshot[key] for key in ("status", "kafka", "stale", "error", "rejected_events")}
        if self.state.current is None:
            raise ValueError("No telemetry available")
        if name == "get_temperature_forecast":
            if self.equipment != "reheater":
                raise ValueError("Forecast only supports the selected reheater equipment")
            return forecast(self.state)
        if name == "get_sensor_history":
            return {"equipment": self.equipment, "tag": self.tag, "points": [
                {"source_time": event["source_time"], **event["sensors"][self.tag]} for event in self.state.history[-30:]]}
        if name == "get_deviation_summary":
            return sensor_summary(self.state, self.tag)
        role = {"get_operating_targets": "target", "get_current_controls": "control"}.get(name)
        return {"equipment": self.equipment, "source_time": self.state.current["source_time"],
                "sensors": {tag: self.state.current["sensors"][tag] for tag in self.tags
                            if role is None or self.state.registry[tag]["measurement_type"] == role}}
