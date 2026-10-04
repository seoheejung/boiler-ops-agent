import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend.app.config import Settings
from backend.app.domain.registry import EQUIPMENT, make_registry
from backend.app.domain.state import BoilerState
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
            "position_basis": "Logical scene coordinates; not physical instrument positions"}


@app.get("/api/state")
async def state():
    return app.state.boiler.snapshot()


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
