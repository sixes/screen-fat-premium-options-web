from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.manager import manager
from app.universe import load_universe, get_all_available_symbols
from app.ws import handle_listen_ws, handle_screen_ws

app = FastAPI(title="Fat Premium Options Screener")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/universe")
async def get_universe():
    return {
        "default": load_universe(),
        "groups": get_all_available_symbols(),
    }


@app.get("/api/state")
async def get_state():
    return manager.get_state()


@app.post("/api/unsubscribe/{underlying}")
async def unsubscribe(underlying: str):
    ok = await manager.unsubscribe_underlying(underlying.upper())
    if not ok:
        raise HTTPException(status_code=404, detail=f"{underlying} not subscribed")
    return {"unsubscribed": underlying.upper()}


@app.websocket("/api/ws/screen")
async def screen_websocket(websocket: WebSocket):
    await handle_screen_ws(websocket)


@app.websocket("/api/ws/listen")
async def listen_websocket(websocket: WebSocket):
    await handle_listen_ws(websocket)
