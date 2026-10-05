import json
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException


class TraceStore:
    record_limit = 1000
    byte_limit = 64 * 1024 * 1024
    record_bytes = 256 * 1024

    def __init__(self):
        self.directory = Path(os.getenv("AGENT_TRACE_DIR", "artifacts/agent/traces"))
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.pending = 0

    @contextmanager
    def reserve(self):
        with self.lock:
            files = list(self.directory.glob("*.json"))
            if (len(files) + self.pending >= self.record_limit or
                    sum(file.stat().st_size for file in files) + (self.pending + 1) * self.record_bytes > self.byte_limit):
                raise HTTPException(507, "Trace capacity reached; archive records before retrying")
            self.pending += 1
        try:
            yield
        finally:
            with self.lock:
                self.pending -= 1

    def write(self, trace):
        data = json.dumps(trace, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(data) > self.record_bytes:
            trace = {key: trace[key] for key in ("trace_id", "owner", "created_at", "request", "context")}
            trace["error"] = "Trace exceeded record size limit"
            data = json.dumps(trace, ensure_ascii=False).encode("utf-8")
        path = self.directory / f"{UUID(trace['trace_id'])}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)

    def read(self, trace_id, principal):
        path = self.directory / f"{UUID(str(trace_id))}.json"
        if not path.is_file() or path.stat().st_size > self.record_bytes:
            raise HTTPException(404, "Trace not found")
        trace = json.loads(path.read_text(encoding="utf-8"))
        if trace.get("owner") != principal.user_id:
            raise HTTPException(404, "Trace not found")
        return trace
