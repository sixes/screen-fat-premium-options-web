from __future__ import annotations

from datetime import date


def compute_dte(expiry: date, today: date) -> int:
    return (expiry - today).days


def mid_price(bid: float, ask: float) -> float:
    return (bid + ask) / 2


def is_liquid(
    bid: float,
    ask: float,
    open_interest: int,
    min_open_interest: int = 5,
    max_spread_ratio: float = 0.5,
) -> tuple[bool, str | None]:
    if bid <= 0:
        return False, "no_bid"

    mid = mid_price(bid, ask)
    if mid <= 0:
        return False, "no_bid"

    spread_ratio = (ask - bid) / mid
    if spread_ratio > max_spread_ratio:
        return False, "wide_spread"

    if open_interest < min_open_interest:
        return False, "low_open_interest"

    return True, None


def annualized_return(
    side: str,
    premium_mid: float,
    strike: float,
    underlying_price: float,
    dte: int,
) -> float | None:
    if dte <= 0:
        return None

    if side == "put":
        if strike <= 0:
            return None
        return (premium_mid / strike) * (365 / dte) * 100
    else:
        if underlying_price <= 0:
            return None
        return (premium_mid / underlying_price) * (365 / dte) * 100


def compute_iv_rank(current_iv: float, candles: list[dict]) -> float | None:
    import math

    if len(candles) < 60:
        return None

    closes = [c["close"] for c in candles]
    log_returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]

    if len(log_returns) < 30:
        return None

    window = 30
    rolling_rvs = []
    for i in range(window, len(log_returns) + 1):
        segment = log_returns[i - window : i]
        mean = sum(segment) / window
        variance = sum((r - mean) ** 2 for r in segment) / (window - 1)
        rv = math.sqrt(variance) * math.sqrt(252)
        rolling_rvs.append(rv)

    if not rolling_rvs:
        return None

    rv_min = min(rolling_rvs)
    rv_max = max(rolling_rvs)

    if rv_max - rv_min < 1e-9:
        return 50.0

    rank = (current_iv - rv_min) / (rv_max - rv_min) * 100
    return max(0.0, min(100.0, rank))


def probability_of_profit(
    side: str,
    strike: float,
    underlying_price: float,
    iv: float,
    dte: int,
) -> float:
    import math

    if iv <= 0 or dte <= 0 or underlying_price <= 0 or strike <= 0:
        if side == "put":
            return 100.0 if strike < underlying_price else 0.0
        else:
            return 100.0 if strike > underlying_price else 0.0

    t = dte / 365.0
    d2 = (math.log(underlying_price / strike) + (-iv**2 / 2) * t) / (iv * math.sqrt(t))

    if side == "put":
        return _norm_cdf(d2) * 100
    else:
        return _norm_cdf(-d2) * 100


def expected_value(pop: float, premium: float, collateral: float) -> float:
    p = pop / 100.0
    max_loss = collateral - premium
    return p * premium - (1 - p) * max_loss


def _norm_cdf(x: float) -> float:
    import math
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))
