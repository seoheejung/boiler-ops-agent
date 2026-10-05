import json
import os
import uuid
from datetime import UTC, datetime
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from backend.app.agent.tools import TOOL_NAMES


class AgentQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=1000)
    equipment: str = Field(min_length=1, max_length=40)
    tag: str | None = Field(default=None, max_length=200)


class ToolPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tools: list[Literal["get_boiler_status", "get_equipment_status", "get_sensor_history", "get_operating_targets", "get_current_controls", "get_deviation_summary", "get_temperature_forecast"]] = Field(min_length=1, max_length=4)


class Findings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_ids: list[str] = Field(min_length=1, max_length=6)
    assessment: Literal["관측값 요약", "변화 추적", "결측 데이터 확인", "추가 근거 필요"]


class AgentFailure(Exception):
    def __init__(self, trace_id, reason):
        super().__init__(reason)
        self.trace_id = trace_id


class NoModelRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise ValueError("Model endpoint redirects are not allowed")


def model_json(messages, schema):
    base, model = os.getenv("OLLAMA_BASE_URL"), os.getenv("OLLAMA_MODEL")
    if not base or not model:
        raise ValueError("OLLAMA_BASE_URL and OLLAMA_MODEL are required for Agent queries")
    parsed = urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.username or parsed.password:
        raise ValueError("Agent model endpoint must be a local Ollama HTTP endpoint")
    body = {"model": model, "messages": messages, "stream": False, "format": schema,
            "options": {"temperature": 0, "seed": 7, "num_predict": 220, "num_ctx": 8192}}
    request = Request(base.rstrip('/') + '/api/chat', data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with build_opener(ProxyHandler({}), NoModelRedirect()).open(request, timeout=180) as response:
        data = response.read(256 * 1024 + 1)
        if len(data) > 256 * 1024:
            raise ValueError("Model response size limit exceeded")
        payload = json.loads(data)
    return json.loads(payload["message"]["content"])


def query_agent(request, tools, principal, store):
    trace_id = str(uuid.uuid4())
    trace = {"trace_id": trace_id, "created_at": datetime.now(UTC).isoformat(), "request": request.model_dump(),
             "owner": principal.user_id,
             "context": {"run_id": (tools.state.current or {}).get("run_id"),
                         "sequence": (tools.state.current or {}).get("sequence"), "tag": tools.tag},
             "model": os.getenv("OLLAMA_MODEL"), "calls": [], "evidence": [], "snapshot_status": tools.snapshot["status"]}
    try:
        plan_schema = ToolPlan.model_json_schema()
        allowed = [name for name in TOOL_NAMES if name != 'get_temperature_forecast' or request.equipment == 'reheater']
        plan_schema['properties']['tools']['items']['enum'] = allowed
        plan = ToolPlan.model_validate(model_json([
            {"role": "system", "content": "Choose read-only boiler tools relevant to the question. The equipment is fixed by the application. get_temperature_forecast is only available for reheater. Never request writes. Return tools in JSON. Tools: " + ', '.join(TOOL_NAMES)},
            {"role": "user", "content": json.dumps(request.model_dump(), ensure_ascii=False)}], plan_schema))
        names = list(dict.fromkeys(["get_equipment_status", *plan.tools]))
        for name in names:
            call_id = f"tool-{len(trace['calls']) + 1}"
            call = {"id": call_id, "tool": name, "equipment": request.equipment, "tag": tools.tag}
            trace["calls"].append(call)
            call["result"] = tools.call(name)
            result = call["result"]
            for tag, reading in result.get("sensors", {}).items():
                trace["evidence"].append({"id": f"e{len(trace['evidence']) + 1}", "tool_id": call_id,
                    "path": ["sensors", tag, "value"], "tag": tag, "field": "관측값", "value": reading["value"], "quality": reading["quality"]})
            if name == "get_deviation_summary":
                for field in ("current", "rate_per_source_minute", "baseline_mean", "z_score"):
                    trace["evidence"].append({"id": f"e{len(trace['evidence']) + 1}", "tool_id": call_id,
                        "path": [field], "tag": result["tag"], "field": field, "value": result[field]})
            if name == "get_temperature_forecast":
                for field in ("input_value", "prediction", "horizon_minutes"):
                    trace["evidence"].append({"id": f"e{len(trace['evidence']) + 1}", "tool_id": call_id,
                        "path": [field], "tag": result["target"], "field": field, "value": result[field]})
        candidates = trace["evidence"]
        if not candidates:
            raise ValueError("No traceable evidence returned by read tools")
        schema = Findings.model_json_schema()
        schema["properties"]["evidence_ids"]["items"] = {"type": "string", "enum": [item["id"] for item in candidates]}
        findings = Findings.model_validate(model_json([
            {"role": "system", "content": "Select evidence IDs relevant to the user's question. Only supplied IDs are allowed. Missing values are unknown. Do not infer control causality. Choose an assessment and evidence_ids in JSON."},
            {"role": "user", "content": json.dumps({"question": request.question, "equipment": request.equipment, "evidence": candidates}, ensure_ascii=False)}], schema))
        by_id = {item["id"]: item for item in candidates}
        if any(key not in by_id for key in findings.evidence_ids):
            raise ValueError("Model selected evidence outside the tool results")
        selected = [by_id[key] for key in dict.fromkeys(findings.evidence_ids)]
        result = {"trace_id": trace_id, "equipment": request.equipment, "model": trace["model"],
                  "assessment": findings.assessment, "evidence": selected, "status": tools.snapshot["status"],
                  "answer": '\n'.join(f"{item['tag']} / {item['field']}: {item['value'] if item['value'] is not None else '결측·미확인'} [{item['id']}]" for item in selected),
                  "limitations": "수신 시점의 관측값입니다. 단위·산업 안전 기준·제어 인과관계 미확인. 쓰기를 실행하지 않습니다."}
        trace["response"] = result
        return result
    except (ValueError, KeyError, TypeError, URLError, OSError) as error:
        trace["error"] = f"{type(error).__name__}: {error}"
        raise AgentFailure(trace_id, trace["error"]) from error
    finally:
        store.write(trace)
