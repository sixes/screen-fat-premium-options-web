from __future__ import annotations

import asyncio
import logging
import time
import warnings
from collections import deque
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from longport.openapi import Config, QuoteContext, SubType

from app.config import Settings
from app.models import OptionContract

US_EASTERN = ZoneInfo("US/Eastern")
logger = logging.getLogger(__name__)

OPTION_QUOTE_BATCH_SIZE = 20
DEPTH_BATCH_SIZE = 20
RATE_LIMIT_CONTRACTS = 500
RATE_LIMIT_WINDOW_S = 60.0


class _ContractRateLimiter:
    def __init__(self, max_count: int, window_s: float):
        self._max = max_count
        self._window = window_s
        self._touches: deque[float] = deque()
        self._lock = asyncio.Lock()
        self.enabled = True

    async def acquire(self, n: int) -> None:
        if n <= 0 or not self.enabled:
            return
        while True:
            async with self._lock:
                now = time.monotonic()
                cutoff = now - self._window
                while self._touches and self._touches[0] < cutoff:
                    self._touches.popleft()

                if len(self._touches) + n <= self._max:
                    for _ in range(n):
                        self._touches.append(now)
                    return

                wait_until = self._touches[len(self._touches) + n - self._max - 1] + self._window
                sleep_for = max(0.01, wait_until - now)

            logger.info(f"Rate limit: sleeping {sleep_for:.1f}s before {n} more contract(s)")
            await asyncio.sleep(sleep_for)


class LongBridgeClient:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._ctx: QuoteContext | None = None
        self._limiter = _ContractRateLimiter(RATE_LIMIT_CONTRACTS, RATE_LIMIT_WINDOW_S)

    async def connect(self) -> None:
        config = await asyncio.to_thread(Config.from_env)
        self._ctx = await asyncio.to_thread(QuoteContext, config)

    async def close(self) -> None:
        self._ctx = None

    def set_depth_callback(self, callback) -> None:
        self.ctx.set_on_depth(callback)

    async def subscribe_depth(self, symbols: list[str]) -> None:
        batch_size = 20
        for i in range(0, len(symbols), batch_size):
            batch = symbols[i : i + batch_size]
            await self._limiter.acquire(len(batch))
            await asyncio.to_thread(self.ctx.subscribe, batch, [SubType.Depth])
        logger.info(f"Subscribed to depth for {len(symbols)} contracts")

    def unsubscribe_depth(self, symbols: list[str]) -> None:
        try:
            self.ctx.unsubscribe(symbols, [SubType.Depth])
            logger.info(f"Unsubscribed from depth for {len(symbols)} contracts")
        except Exception as e:
            logger.warning(f"Unsubscribe failed: {e}")

    @property
    def ctx(self) -> QuoteContext:
        if self._ctx is None:
            raise RuntimeError("Client not connected. Call connect() first.")
        return self._ctx

    async def get_option_expirations(self, symbol: str, max_dte: int) -> list[date]:
        today = datetime.now(US_EASTERN).date()
        resp = await asyncio.to_thread(self.ctx.option_chain_expiry_date_list, symbol)
        result = []
        for exp_date in resp:
            d = exp_date.date() if isinstance(exp_date, datetime) else exp_date
            dte = (d - today).days
            if 0 <= dte <= max_dte:
                result.append(d)
        return result

    async def get_option_chain(self, symbol: str, expiry: date) -> list[dict]:
        resp = await asyncio.to_thread(self.ctx.option_chain_info_by_date, symbol, expiry)
        entries = []
        for item in resp:
            entries.append({
                "call_symbol": item.call_symbol,
                "put_symbol": item.put_symbol,
                "strike": float(item.price),
            })
        return entries

    async def get_option_quotes(
        self, option_symbols: list[str], underlying_price: float, underlying: str,
        max_moneyness: float = 1.0, min_moneyness: float = 0.0,
        min_open_interest: int = 0,
        skip_depth: bool = False,
    ) -> list[OptionContract]:
        if not option_symbols:
            return []

        today = datetime.now(US_EASTERN).date()
        contracts = []
        total = len(option_symbols)

        for i in range(0, total, OPTION_QUOTE_BATCH_SIZE):
            batch = option_symbols[i : i + OPTION_QUOTE_BATCH_SIZE]

            await self._limiter.acquire(len(batch))
            try:
                resp = await asyncio.to_thread(self.ctx.option_quote, batch)
            except Exception as e:
                logger.warning(f"option_quote batch failed: {e}")
                continue

            for quote in resp:
                try:
                    oi = int(quote.open_interest or 0)
                    volume = int(quote.volume or 0)
                    iv = float(quote.implied_volatility or 0) if quote.implied_volatility else 0.0
                    strike = float(quote.strike_price)
                    exp = quote.expiry_date.date() if isinstance(quote.expiry_date, datetime) else quote.expiry_date
                    dte = (exp - today).days

                    side = "call" if "call" in str(quote.direction).lower() else "put"

                    moneyness = abs(strike - underlying_price) / underlying_price if underlying_price > 0 else 0.0

                    if max_moneyness > 0 and moneyness > max_moneyness:
                        continue

                    if min_moneyness > 0:
                        if side == "call" and (strike - underlying_price) / underlying_price < min_moneyness:
                            continue
                        if side == "put" and (underlying_price - strike) / underlying_price < min_moneyness:
                            continue

                    if oi < min_open_interest:
                        continue

                    contracts.append(_PendingContract(
                        underlying=underlying,
                        symbol=quote.symbol,
                        side=side,
                        expiration=exp,
                        dte=dte,
                        strike=strike,
                        iv=iv,
                        open_interest=oi,
                        volume=volume,
                        underlying_price=underlying_price,
                        moneyness=moneyness,
                    ))
                except (AttributeError, TypeError, ValueError) as e:
                    warnings.warn(f"Error parsing quote for {getattr(quote, 'symbol', '?')}: {e}")
                    continue

        if skip_depth:
            return [
                OptionContract(
                    underlying=pc.underlying,
                    symbol=pc.symbol,
                    side=pc.side,
                    expiration=pc.expiration,
                    dte=pc.dte,
                    strike=pc.strike,
                    bid=0.0,
                    ask=0.0,
                    mid=0.0,
                    delta=pc.moneyness,
                    iv=pc.iv,
                    open_interest=pc.open_interest,
                    volume=pc.volume,
                    underlying_price=pc.underlying_price,
                )
                for pc in contracts
            ]

        return await self._fetch_bid_ask(contracts)

    async def _fetch_bid_ask(self, pending: list[_PendingContract]) -> list[OptionContract]:
        results = []
        total = len(pending)
        if total == 0:
            return results

        for i in range(0, total, DEPTH_BATCH_SIZE):
            batch = pending[i : i + DEPTH_BATCH_SIZE]

            for pc in batch:
                await self._limiter.acquire(1)
                try:
                    depth = await asyncio.to_thread(self.ctx.depth, pc.symbol)
                    bid = float(depth.bids[0].price) if depth.bids and depth.bids[0].price else 0.0
                    ask = float(depth.asks[0].price) if depth.asks and depth.asks[0].price else 0.0
                except Exception:
                    bid = 0.0
                    ask = 0.0

                mid = (bid + ask) / 2 if (bid + ask) > 0 else 0.0

                results.append(OptionContract(
                    underlying=pc.underlying,
                    symbol=pc.symbol,
                    side=pc.side,
                    expiration=pc.expiration,
                    dte=pc.dte,
                    strike=pc.strike,
                    bid=bid,
                    ask=ask,
                    mid=mid,
                    delta=pc.moneyness,
                    iv=pc.iv,
                    open_interest=pc.open_interest,
                    volume=pc.volume,
                    underlying_price=pc.underlying_price,
                ))

        return results

    async def get_historical_candles(self, symbol: str, days: int = 252) -> list[dict]:
        from datetime import timedelta
        from longport.openapi import Period, AdjustType

        today = datetime.now(US_EASTERN).date()
        start = today - timedelta(days=int(days * 1.5))
        try:
            resp = await asyncio.to_thread(
                self.ctx.history_candlesticks_by_date,
                symbol, Period.Day, AdjustType.ForwardAdjust,
                start, today,
            )
        except Exception as e:
            logger.warning(f"history_candlesticks_by_date({symbol}) failed: {e}")
            return []

        candles = []
        for c in resp:
            candles.append({
                "close": float(c.close),
                "high": float(c.high),
                "low": float(c.low),
                "open": float(c.open),
            })
        return candles[-days:] if len(candles) > days else candles

    async def get_underlying_price(self, symbol: str) -> float | None:
        resp = await asyncio.to_thread(self.ctx.quote, [symbol])
        if resp:
            return float(resp[0].last_done)
        return None


class _PendingContract:
    __slots__ = (
        "underlying", "symbol", "side", "expiration", "dte",
        "strike", "iv", "open_interest", "volume",
        "underlying_price", "moneyness",
    )

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
