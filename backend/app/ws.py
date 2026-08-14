from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect

from app.config import ScreenParams, load_settings
from app.manager import manager
from app.models import ScreenResult

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class WsLogHandler(logging.Handler):
    def __init__(self, queue: asyncio.Queue):
        super().__init__()
        self._queue = queue

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            self._queue.put_nowait({"type": "log", "message": msg, "level": record.levelname.lower()})
        except Exception:
            pass


async def handle_screen_ws(websocket: WebSocket) -> None:
    """Handle a screening request. Screens new underlyings, subscribes globally, then closes."""
    await websocket.accept()

    try:
        raw = await websocket.receive_text()
        data = json.loads(raw)
        params = ScreenParams(**data)
    except (json.JSONDecodeError, Exception) as e:
        await websocket.send_json({"type": "error", "message": f"Invalid parameters: {e}"})
        await websocket.close()
        return

    try:
        settings = load_settings()
    except EnvironmentError as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return

    symbols = [s.upper() for s in params.symbols]
    params.symbols = symbols

    already = [s for s in symbols if manager.is_subscribed(s)]
    if already:
        await websocket.send_json({
            "type": "log",
            "message": f"Already subscribed (skipped): {', '.join(already)}",
            "level": "info",
        })
        await websocket.send_json({"type": "skipped", "underlyings": already})

    to_screen = [s for s in symbols if not manager.is_subscribed(s)]
    if not to_screen:
        await websocket.send_json({
            "type": "completed",
            "total_results": 0,
            "elapsed": 0.0,
            "skipped": True,
        })
        await websocket.close()
        return

    send_queue: asyncio.Queue = asyncio.Queue()

    log_handler = WsLogHandler(send_queue)
    log_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S"))
    log_handler.setLevel(logging.INFO)

    app_logger = logging.getLogger("app")
    app_logger.setLevel(logging.DEBUG)
    app_logger.addHandler(log_handler)

    await websocket.send_json({"type": "started", "symbols": to_screen, "total": len(to_screen)})

    completed_count = 0
    total_results: list[ScreenResult] = []
    run_start = time.perf_counter()
    stop_event = asyncio.Event()

    async def queue_sender():
        while not stop_event.is_set():
            try:
                msg = await asyncio.wait_for(send_queue.get(), timeout=1.0)
                await websocket.send_json(msg)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break

    async def on_symbol_done(symbol: str, results: list[ScreenResult], elapsed: float) -> None:
        nonlocal completed_count
        completed_count += 1
        total_results.extend(results)
        sorted_results = sorted(results, key=lambda r: -r.ann_return_pct)
        try:
            await websocket.send_json({
                "type": "symbol_done",
                "symbol": symbol,
                "results": [r.to_dict() for r in sorted_results],
                "count": len(sorted_results),
                "elapsed": round(elapsed, 1),
                "progress": completed_count,
                "total": len(to_screen),
            })
        except Exception:
            pass

    async def on_contract_found(result: ScreenResult) -> None:
        try:
            await websocket.send_json({
                "type": "contract_found",
                "result": result.to_dict(),
            })
        except Exception:
            pass

    async def heartbeat():
        while not stop_event.is_set():
            await asyncio.sleep(5)
            if stop_event.is_set():
                break
            try:
                elapsed = round(time.perf_counter() - run_start, 1)
                await websocket.send_json({
                    "type": "heartbeat",
                    "elapsed": elapsed,
                    "progress": completed_count,
                    "total": len(to_screen),
                })
            except Exception:
                break

    async def wait_for_stop():
        try:
            while True:
                msg = await websocket.receive_text()
                if msg == "stop":
                    return "stop"
        except WebSocketDisconnect:
            return "disconnect"
        except Exception:
            return "disconnect"

    sender_task = asyncio.create_task(queue_sender())
    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        for symbol in to_screen:
            try:
                await websocket.send_json({
                    "type": "symbol_progress",
                    "symbol": symbol,
                    "status": "screening",
                })
            except Exception:
                pass

        screening_task = asyncio.create_task(
            manager.screen_and_subscribe(settings, params, on_symbol_done=on_symbol_done, on_contract_found=on_contract_found)
        )
        disconnect_task = asyncio.create_task(wait_for_stop())

        done, _pending = await asyncio.wait(
            [screening_task, disconnect_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        if screening_task in done:
            disconnect_task.cancel()
            screened, _skipped = screening_task.result()
            total_elapsed = time.perf_counter() - run_start
            await websocket.send_json({
                "type": "subscribed",
                "count": sum(1 for r in total_results),
            })
            await websocket.send_json({
                "type": "completed",
                "total_results": len(total_results),
                "elapsed": round(total_elapsed, 1),
            })
        else:
            screening_task.cancel()
            try:
                await screening_task
            except (asyncio.CancelledError, Exception):
                pass
            logger.info("Screening cancelled by client")
            try:
                await websocket.send_json({"type": "stopped", "message": "Screening stopped"})
            except Exception:
                pass

    except Exception as e:
        logger.error(f"Screening error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        stop_event.set()
        heartbeat_task.cancel()
        sender_task.cancel()
        app_logger.removeHandler(log_handler)
        try:
            await websocket.close()
        except Exception:
            pass


async def handle_listen_ws(websocket: WebSocket) -> None:
    """Persistent listener for live depth updates and subscription state changes."""
    await websocket.accept()

    queue = manager.add_listener()

    # Send initial state snapshot on connect
    try:
        await websocket.send_json({
            "type": "state",
            **manager.get_state(),
        })
    except Exception:
        manager.remove_listener(queue)
        return

    stop_event = asyncio.Event()

    async def drain_queue():
        while not stop_event.is_set():
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=1.0)
                await websocket.send_json(msg)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break

    async def watch_client():
        try:
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    break
        except Exception:
            pass

    async def heartbeat():
        import datetime
        loop = asyncio.get_running_loop()
        # Align first tick to the next whole second so displayed HH:MM:SS is monotonic
        deadline = loop.time()
        while not stop_event.is_set():
            try:
                now = datetime.datetime.now(datetime.timezone.utc)
                await websocket.send_json({
                    "type": "listener_heartbeat",
                    "server_time": now.isoformat(),
                    "epoch_ms": int(now.timestamp() * 1000),
                    "subscribed_underlyings": len(manager.subscribed_underlyings),
                    "total_contracts": len(manager.results),
                    "listeners": len(manager._listeners),
                })
            except Exception:
                break
            deadline += 1.0
            wait = deadline - loop.time()
            if wait < 0:
                # We fell behind; catch up to the next boundary
                deadline = loop.time() + 1.0
                wait = 1.0
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=wait)
                break
            except asyncio.TimeoutError:
                continue

    drain_task = asyncio.create_task(drain_queue())
    watch_task = asyncio.create_task(watch_client())
    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        await asyncio.wait([drain_task, watch_task], return_when=asyncio.FIRST_COMPLETED)
    finally:
        stop_event.set()
        drain_task.cancel()
        watch_task.cancel()
        heartbeat_task.cancel()
        manager.remove_listener(queue)
        try:
            await websocket.close()
        except Exception:
            pass
