import asyncio
import json
from uuid import UUID
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query

from backend.app.config import Settings
from backend.app.domain.registry import EQUIPMENT, PROCESS_FLOWS, make_registry
from backend.app.domain.state import BoilerState
from backend.app.domain.analysis import loop_analysis, sensor_summary
from backend.app.agent.tools import ReadTools
from backend.app.agent.service import AgentQuery, AgentFailure, query_agent, trace_directory
from backend.app.forecast.service import forecast
from backend.app.replay.csv_source import columns
from backend.app.streaming.consumer import consume
from backend.app.websocket.hub import Hub


@asynccontextmanager
async def lifespan(app):
    settings = Settings.load()
    registry = make_registry([tag for tag in columns(settings) if tag != settings.time_column])
    app.state.boiler = BoilerState(registry, settings)
    app.state.hub = Hub()
    task = asyncio.create_task(consume(settings, app.state.boiler, app.state.hub))
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="BoilerOps Agent", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return app.state.boiler.snapshot()


@app.get("/api/registry")
async def registry():
    return {"sensors": app.state.boiler.registry, "equipment": EQUIPMENT,
            "hierarchy": {"id": "boiler", "children": [item["id"] for item in EQUIPMENT] + ["generation", "unmapped"]},
            "flows": PROCESS_FLOWS,
            "position_basis": "Logical scene coordinates; not physical instrument positions"}


@app.get("/api/state")
async def state():
    return app.state.boiler.snapshot()


@app.get("/api/sensors/history")
async def history(tag: str, limit: int = Query(120, ge=1, le=3600)):
    boiler = app.state.boiler
    if tag not in boiler.registry:
        raise HTTPException(404, "Unknown sensor tag")
    return {"tag": tag, "unit": boiler.registry[tag]["unit"], "points": [
        {"sequence": event["sequence"], "source_time": event["source_time"], **event["sensors"][tag]}
        for event in list(boiler.history)[-limit:]]}


@app.get("/api/analysis/loop")
async def analysis_loop(name: str = "reheater", limit: int = Query(120, ge=1, le=3600)):
    try:
        return loop_analysis(app.state.boiler, name, limit)
    except ValueError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/analysis/sensor")
async def analysis_sensor(tag: str):
    try:
        return sensor_summary(app.state.boiler, tag)
    except ValueError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/forecast")
async def temperature_forecast():
    try:
        return forecast(app.state.boiler)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@app.get("/api/tools/{name}")
async def read_tool(name: str, equipment: str, tag: str | None = None):
    try:
        return ReadTools(app.state.boiler, equipment, tag).call(name)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/api/agent/query")
async def agent_query(request: AgentQuery):
    try:
        tools = ReadTools(app.state.boiler, request.equipment, request.tag)
        return await asyncio.to_thread(query_agent, request, tools)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except AgentFailure as error:
        raise HTTPException(503, {"trace_id": error.trace_id, "error": str(error)}) from error


@app.get("/api/agent/traces/{trace_id}")
async def agent_trace(trace_id: UUID):
    path = trace_directory() / f"{trace_id}.json"
    if not path.is_file():
        raise HTTPException(404, "Trace not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    hub = app.state.hub
    queue = hub.subscribe()

    async def send():
        await ws.send_json(app.state.boiler.snapshot())
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=.5)
            except TimeoutError:
                message = app.state.boiler.snapshot()
            await ws.send_json(message)

    async def receive():
        while True:
            await ws.receive_text()

    tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    finally:
        hub.unsubscribe(queue)
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, OSError):
                await task
