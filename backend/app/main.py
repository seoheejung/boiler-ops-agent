import asyncio
from uuid import UUID
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request, Response

from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse
from backend.app.security import Security, SecurityMiddleware, Login
from backend.app.agent.traces import TraceStore
from backend.app.config import Settings
from backend.app.domain.registry import EQUIPMENT, PROCESS_FLOWS, make_registry
from backend.app.domain.state import BoilerState
from backend.app.domain.analysis import loop_analysis, sensor_summary
from backend.app.agent.tools import ReadTools
from backend.app.agent.service import AgentQuery, AgentFailure, query_agent
from backend.app.forecast.service import forecast
from backend.app.simulator.service import Simulator, SimulatorError, ProposalRequest, Decision
from backend.app.replay.csv_source import columns
from backend.app.streaming.consumer import consume
from backend.app.websocket.hub import Hub


@asynccontextmanager
async def lifespan(app):
    settings = Settings.load()
    registry = make_registry([tag for tag in columns(settings) if tag != settings.time_column])
    app.state.boiler = BoilerState(registry, settings)
    app.state.hub = Hub()
    from backend.app.streaming.security import kafka_options
    kafka_options("consumer", settings.brokers)
    app.state.security = Security()
    app.state.traces = TraceStore()
    app.state.simulator = Simulator(app.state.boiler, app.state.traces)
    task = asyncio.create_task(consume(settings, app.state.boiler, app.state.hub))
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="BoilerOps Agent", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityMiddleware, owner=app)


@app.exception_handler(RequestValidationError)
async def validation_error(request, error):
    return JSONResponse({"detail": [{"loc": item["loc"], "type": item["type"]} for item in error.errors()]}, status_code=422)


@app.post("/api/session")
async def login(credentials: Login, request: Request, response: Response):
    security = app.state.security
    token, principal = security.login(credentials)
    security.logout(request.scope)
    response.set_cookie(security.cookie_name, token, max_age=security.session_seconds,
                        httponly=True, secure=security.secure_cookie, samesite="strict", path="/")
    return principal


@app.get("/api/session")
async def session(request: Request):
    return request.state.principal


@app.delete("/api/session")
async def logout(request: Request, response: Response):
    app.state.security.logout(request.scope)
    response.delete_cookie(app.state.security.cookie_name, path="/")
    return {"status": "logged_out"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


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
async def agent_query(request: AgentQuery, http: Request):
    try:
        tools = ReadTools(app.state.boiler, request.equipment, request.tag)
        def work():
            with app.state.traces.reserve():
                return query_agent(request, tools, http.state.principal, app.state.traces)
        return await app.state.security.model_work(http.state.principal, work)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except AgentFailure as error:
        raise HTTPException(503, {"trace_id": error.trace_id, "error": str(error)}) from error


@app.get("/api/agent/traces/{trace_id}")
async def agent_trace(trace_id: UUID, request: Request):
    return app.state.traces.read(trace_id, request.state.principal)


@app.get("/api/simulator")
async def simulator_state(request: Request):
    return app.state.simulator.snapshot(request.state.principal)


@app.get("/api/simulator/audit")
async def simulator_audit(request: Request, after_id: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    return app.state.simulator.audit_log(request.state.principal, after_id, limit)


@app.post("/api/simulator/proposals")
async def simulator_propose(request: ProposalRequest, http: Request):
    try:
        return await app.state.security.model_work(http.state.principal, lambda: app.state.simulator.propose(request, http.state.principal))
    except SimulatorError as error:
        raise HTTPException(error.status, str(error)) from error
    except (ValueError, OSError, KeyError) as error:
        raise HTTPException(503, f"Simulator recommendation failed: {type(error).__name__}: {error}") from error


@app.post("/api/simulator/proposals/{proposal_id}/decision")
async def simulator_decide(proposal_id: UUID, decision: Decision, request: Request):
    try:
        app.state.security.operator(request.state.principal)
        return app.state.simulator.decide(proposal_id, decision, request.state.principal)
    except SimulatorError as error:
        raise HTTPException(error.status, str(error)) from error


@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    security = app.state.security
    try:
        principal = security.websocket_open(ws.scope)
    except HTTPException:
        await ws.close(code=1008)
        return
    try:
        await ws.accept()
    except (WebSocketDisconnect, RuntimeError, OSError, asyncio.CancelledError):
        security.websocket_close(principal)
        raise
    hub = app.state.hub
    queue = hub.subscribe()

    async def send():
        await ws.send_json(app.state.boiler.snapshot())
        while True:
            try:
                security.principal(ws.scope)
            except HTTPException:
                await ws.close(code=1008, reason="Session expired or revoked")
                return
            try:
                message = await asyncio.wait_for(queue.get(), timeout=.5)
            except TimeoutError:
                message = app.state.boiler.snapshot()
            if message.get('type') == 'overflow':
                await ws.close(code=1013, reason='Telemetry subscriber fell behind; reconnect required')
                return
            await ws.send_json(message)

    async def receive():
        while True:
            message = await ws.receive_text()
            if len(message) > 1024:
                await ws.close(code=1009)
                return
            security.rate(("ws-message", principal.user_id), 30)

    tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except HTTPException:
        with suppress(WebSocketDisconnect, RuntimeError, OSError):
            await ws.close(code=1008, reason="WebSocket message rate exceeded")
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    finally:
        security.websocket_close(principal)
        hub.unsubscribe(queue)
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, OSError, HTTPException):
                await task
