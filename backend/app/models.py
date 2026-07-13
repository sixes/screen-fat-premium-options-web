from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass
class OptionContract:
    underlying: str
    symbol: str
    side: str
    expiration: date
    dte: int
    strike: float
    bid: float
    ask: float
    mid: float
    delta: float
    iv: float
    open_interest: int
    volume: int
    underlying_price: float


@dataclass
class ScreenResult:
    underlying: str
    symbol: str
    side: str
    expiration: date
    dte: int
    strike: float
    bid: float
    ask: float
    mid: float
    delta: float
    iv: float
    open_interest: int
    volume: int
    underlying_price: float
    premium: float
    collateral: float
    ann_return_pct: float
    iv_rank: float
    pop: float
    expected_value: float

    def to_dict(self) -> dict:
        return {
            "underlying": self.underlying,
            "symbol": self.symbol,
            "side": self.side,
            "expiration": self.expiration.isoformat(),
            "dte": self.dte,
            "strike": self.strike,
            "bid": self.bid,
            "ask": self.ask,
            "mid": self.mid,
            "delta": round(self.delta, 4),
            "iv": round(self.iv, 4),
            "open_interest": self.open_interest,
            "volume": self.volume,
            "underlying_price": round(self.underlying_price, 2),
            "premium": round(self.premium, 2),
            "collateral": round(self.collateral, 2),
            "ann_return_pct": round(self.ann_return_pct, 2),
            "iv_rank": round(self.iv_rank, 1),
            "pop": round(self.pop, 1),
            "expected_value": round(self.expected_value, 2),
        }
