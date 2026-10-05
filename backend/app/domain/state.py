import math
import time
from collections import deque
from datetime import UTC, datetime
from uuid import UUID


class BoilerState:
    def __init__(self, registry, settings):
        self.registry = registry
        self.settings = settings
        self.current = None
        self.history = deque(maxlen=settings.history_limit)
        self.received_at = None
        self.kafka = "CONNECTING"
        self.error = None
        self.rejected = 0

    def apply(self, event, offset):
        if not isinstance(event, dict):
            raise ValueError("Event must be an object")
        sequence = event.get("sequence")
        run_id = event.get("run_id")
        if type(sequence) is not int or sequence < 1 or not isinstance(run_id, str) or not run_id:
            raise ValueError("Invalid run_id or sequence")
        try:
            UUID(run_id)
        except ValueError:
            raise ValueError("run_id must be a UUID") from None
        source_time = event.get("source_time")
        emitted_at = event.get("emitted_at")
        try:
            source_instant = datetime.fromisoformat(source_time)
            emitted_instant = datetime.fromisoformat(emitted_at)
        except (TypeError, ValueError) as error:
            raise ValueError("Invalid source_time or emitted_at") from error
        if emitted_instant.tzinfo is None:
            raise ValueError("emitted_at requires timezone")
        if emitted_instant.timestamp() > datetime.now(UTC).timestamp() + 30:
            raise ValueError("emitted_at is in the future")
        if self.current and emitted_instant <= datetime.fromisoformat(self.current["emitted_at"]):
            raise ValueError("Emission time did not increase; replayed event rejected")
        measurements = event.get("measurements")
        if not isinstance(measurements, dict) or set(measurements) != set(self.registry):
            raise ValueError("Event tags do not match CSV registry")
        new_run = self.current is None or run_id != self.current["run_id"]
        if self.current and not new_run:
            if sequence != self.current["sequence"] + 1:
                raise ValueError(f"Sequence violation: expected {self.current['sequence'] + 1}, got {sequence}")
            if source_instant <= datetime.fromisoformat(self.current["source_time"]):
                raise ValueError("Source time did not increase")
        if new_run and sequence != 1:
            raise ValueError("New replay run must begin at sequence 1")
        sensors = {}
        for tag, raw in measurements.items():
            value, quality, message = None, "missing", None
            if not isinstance(raw, str) or len(raw) > 256:
                raise ValueError(f"Non-string raw value for {tag!r}")
            if raw.strip():
                try:
                    value = float(raw)
                    if not math.isfinite(value):
                        raise ValueError("Non-finite value")
                    quality = "valid"
                except ValueError:
                    value, quality, message = None, "parse_error", "Invalid finite number"
            sensors[tag] = {"value": value, "raw": raw, "quality": quality, "error": message}
        if new_run:
            self.history.clear()
        self.current = {"run_id": run_id, "sequence": sequence, "source_time": source_time,
                        "source_row": event.get("source_row"),
                        "emitted_at": emitted_at, "kafka_offset": offset, "sensors": sensors}
        self.history.append(self.current)
        self.received_at = time.monotonic()
        self.error = None

    def snapshot(self):
        stale = self.received_at is None or (time.monotonic() - self.received_at) * 1000 > self.settings.stale_ms
        status = "ERROR" if self.error else "DISCONNECTED" if self.kafka != "CONNECTED" else "STALE" if stale else "LIVE"
        return {"type": "telemetry", "current": self.current, "status": status, "stale": stale,
                "kafka": self.kafka, "error": self.error, "rejected_events": self.rejected,
                "replay_interval_ms": self.settings.interval_ms, "stale_after_ms": self.settings.stale_ms}
