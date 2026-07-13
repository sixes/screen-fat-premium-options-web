from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.config import ScreenParams, Settings
from app.longbridge_client import LongBridgeClient
from app.metrics import annualized_return, expected_value, probability_of_profit
from app.models import ScreenResult
from app.screener import run_screening

logger = logging.getLogger(__name__)


class SubscriptionManager:
    """Global singleton owning the shared LongBridge client and subscription state.

    Subscriptions persist across WebSocket connections. Depth updates are
    broadcast to all registered listener queues.
    """

    def __init__(self):
        self.client: LongBridgeClient | None = None
        self.results: dict[str, ScreenResult] = {}
        self.subscribed_underlyings: set[str] = set()
        self._listeners: list[asyncio.Queue] = []
        self._client_lock = asyncio.Lock()
        self._underlying_locks: dict[str, asyncio.Lock] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    async def ensure_client(self, settings: Settings) -> LongBridgeClient:
        async with self._client_lock:
            if self.client is None:
                logger.info("Creating shared LongBridge client")
                self._loop = asyncio.get_running_loop()
                client = LongBridgeClient(settings)
                await client.connect()
                client.set_depth_callback(self._on_depth_push)
                self.client = client
        return self.client

    def add_listener(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._listeners.append(q)
        logger.info(f"Listener added, total: {len(self._listeners)}")
        return q

    def remove_listener(self, q: asyncio.Queue) -> None:
        try:
            self._listeners.remove(q)
            logger.info(f"Listener removed, total: {len(self._listeners)}")
        except ValueError:
            pass

    def _broadcast(self, msg: dict[str, Any]) -> None:
        loop = self._loop
        for q in list(self._listeners):
            try:
                if loop is not None and asyncio.get_event_loop_policy().get_event_loop() is not loop:
                    loop.call_soon_threadsafe(q.put_nowait, msg)
                else:
                    q.put_nowait(msg)
            except Exception:
                pass

    def get_state(self) -> dict[str, Any]:
        return {
            "subscribed_underlyings": sorted(self.subscribed_underlyings),
            "results": [r.to_dict() for r in self.results.values()],
        }

    def is_subscribed(self, underlying: str) -> bool:
        return underlying in self.subscribed_underlyings

    def _underlying_lock(self, underlying: str) -> asyncio.Lock:
        lock = self._underlying_locks.get(underlying)
        if lock is None:
            lock = asyncio.Lock()
            self._underlying_locks[underlying] = lock
        return lock

    def _on_depth_push(self, symbol: str, depth_event) -> None:
        try:
            bid = float(depth_event.bids[0].price) if depth_event.bids else 0.0
            ask = float(depth_event.asks[0].price) if depth_event.asks else 0.0
        except Exception:
            return

        mid = (bid + ask) / 2 if (bid + ask) > 0 else 0.0
        result = self.results.get(symbol)
        if result is None or mid <= 0:
            return
        if bid == result.bid and ask == result.ask:
            return

        result.bid = bid
        result.ask = ask
        result.mid = mid
        result.premium = mid

        ann_ret = annualized_return(result.side, mid, result.strike, result.underlying_price, result.dte)
        if ann_ret is not None:
            result.ann_return_pct = ann_ret

        pop_val = probability_of_profit(result.side, result.strike, result.underlying_price, result.iv, result.dte)
        result.pop = pop_val

        collateral = result.strike if result.side == "put" else result.underlying_price
        result.collateral = collateral
        result.expected_value = expected_value(pop_val, mid, collateral)

        self._broadcast({"type": "update", "result": result.to_dict()})

    async def screen_and_subscribe(
        self,
        settings: Settings,
        params: ScreenParams,
        on_symbol_done=None,
    ) -> tuple[list[str], list[str]]:
        """Screen only underlyings not already subscribed, add them to global state.

        Returns (screened_underlyings, skipped_underlyings).
        """
        client = await self.ensure_client(settings)

        requested = list(params.symbols)
        to_screen = [s for s in requested if s not in self.subscribed_underlyings]
        skipped = [s for s in requested if s in self.subscribed_underlyings]

        if not to_screen:
            return [], skipped

        params.symbols = to_screen
        # Mark underlyings as claimed early to prevent concurrent screening of same underlying
        for u in to_screen:
            self.subscribed_underlyings.add(u)
            self._broadcast({"type": "underlying_screening", "underlying": u})

        try:
            results = await run_screening(client, params, on_symbol_done=on_symbol_done)
            for r in results:
                self.results[r.symbol] = r
            contract_symbols = [r.symbol for r in results]
            if contract_symbols:
                await client.subscribe_depth(contract_symbols)
            # notify per-underlying; drop underlyings with no results from subscribed set
            by_und: dict[str, list[ScreenResult]] = {}
            for r in results:
                by_und.setdefault(r.underlying, []).append(r)
            for underlying in to_screen:
                res = by_und.get(underlying, [])
                if not res:
                    # No matching contracts — release the claim so user can retry
                    self.subscribed_underlyings.discard(underlying)
                    self._broadcast({
                        "type": "underlying_no_results",
                        "underlying": underlying,
                    })
                    logger.info(f"{underlying}: 0 results after filtering, releasing claim")
                else:
                    self._broadcast({
                        "type": "underlying_subscribed",
                        "underlying": underlying,
                        "count": len(res),
                        "results": [r.to_dict() for r in res],
                    })
            return to_screen, skipped
        except Exception:
            for u in to_screen:
                self.subscribed_underlyings.discard(u)
                self._broadcast({"type": "underlying_removed", "underlying": u})
            raise

    async def unsubscribe_underlying(self, underlying: str) -> bool:
        if underlying not in self.subscribed_underlyings:
            return False
        client = self.client
        contracts = [sym for sym, r in self.results.items() if r.underlying == underlying]
        if client and contracts:
            try:
                await asyncio.to_thread(client.unsubscribe_depth, contracts)
            except Exception as e:
                logger.warning(f"Unsubscribe error for {underlying}: {e}")
        for sym in contracts:
            self.results.pop(sym, None)
        self.subscribed_underlyings.discard(underlying)
        self._broadcast({"type": "underlying_removed", "underlying": underlying})
        return True


manager = SubscriptionManager()
