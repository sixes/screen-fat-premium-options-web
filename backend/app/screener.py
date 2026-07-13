from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from app.config import Settings, ScreenParams
from app.longbridge_client import LongBridgeClient
from app.metrics import annualized_return, compute_iv_rank, expected_value, is_liquid, probability_of_profit
from app.models import OptionContract, ScreenResult

logger = logging.getLogger(__name__)

SymbolDoneCallback = Callable[[str, list[ScreenResult], float], Awaitable[None]]


async def _screen_symbol(
    client: LongBridgeClient,
    params: ScreenParams,
    symbol: str,
    on_symbol_done: SymbolDoneCallback | None = None,
) -> list[ScreenResult]:
    symbol_start = time.perf_counter()
    symbol_results: list[ScreenResult] = []

    try:
        logger.info(f"[{symbol}] Fetching underlying price...")
        price = await client.get_underlying_price(f"{symbol}.US")
        if price is None or price <= 0:
            logger.warning(f"[{symbol}] No underlying price, skipping")
            return symbol_results
        logger.info(f"[{symbol}] Price: ${price:.2f}")

        logger.info(f"[{symbol}] Fetching historical candles...")
        candles = await client.get_historical_candles(f"{symbol}.US")
        logger.info(f"[{symbol}] Got {len(candles)} candles")

        logger.info(f"[{symbol}] Fetching option expirations (max_dte={params.max_dte})...")
        expirations = await client.get_option_expirations(f"{symbol}.US", params.max_dte)
        if not expirations:
            logger.info(f"[{symbol}] No expirations found")
            return symbol_results
        logger.info(f"[{symbol}] {len(expirations)} expirations found")

        iv_rank_value: float | None = None

        for expiry in expirations:
            try:
                if params.pre_market:
                    results = await _premarket_expiry(client, params, symbol, price, candles, expiry)
                    symbol_results.extend(results)
                else:
                    iv_rank_value, contracts_results, abort = await _screen_expiry(
                        client, params, symbol, price, candles, expiry, iv_rank_value
                    )
                    symbol_results.extend(contracts_results)
                    if abort:
                        break
            except Exception as e:
                logger.error(f"Error processing {symbol} {expiry}: {e}", exc_info=True)
                continue

    except Exception as e:
        logger.error(f"Error processing {symbol}: {e}", exc_info=True)

    symbol_elapsed = time.perf_counter() - symbol_start

    if on_symbol_done is not None:
        await on_symbol_done(symbol, symbol_results, symbol_elapsed)

    return symbol_results


async def _premarket_expiry(
    client: LongBridgeClient,
    params: ScreenParams,
    symbol: str,
    price: float,
    candles: list[dict],
    expiry,
) -> list[ScreenResult]:
    chain = await client.get_option_chain(f"{symbol}.US", expiry)
    if not chain:
        return []

    symbols_to_fetch = []
    for entry in chain:
        if params.side in ("both", "call") and entry.get("call_symbol"):
            symbols_to_fetch.append(entry["call_symbol"])
        if params.side in ("both", "put") and entry.get("put_symbol"):
            symbols_to_fetch.append(entry["put_symbol"])

    if not symbols_to_fetch:
        return []

    contracts = await client.get_option_quotes(
        symbols_to_fetch, price, symbol,
        max_moneyness=0,
        min_moneyness=0,
        min_open_interest=params.min_open_interest,
        skip_depth=True,
    )

    results: list[ScreenResult] = []
    for contract in contracts:
        if contract.dte <= 0:
            continue
        if contract.open_interest < params.min_open_interest:
            continue
        results.append(ScreenResult(
            underlying=contract.underlying,
            symbol=contract.symbol,
            side=contract.side,
            expiration=contract.expiration,
            dte=contract.dte,
            strike=contract.strike,
            bid=0.0,
            ask=0.0,
            mid=0.0,
            delta=contract.delta,
            iv=contract.iv,
            open_interest=contract.open_interest,
            volume=contract.volume,
            underlying_price=contract.underlying_price,
            premium=0.0,
            collateral=0.0,
            ann_return_pct=0.0,
            iv_rank=0.0,
            pop=0.0,
            expected_value=0.0,
        ))

    return results


async def _screen_expiry(
    client: LongBridgeClient,
    params: ScreenParams,
    symbol: str,
    price: float,
    candles: list[dict],
    expiry,
    iv_rank_value: float | None,
) -> tuple[float | None, list[ScreenResult], bool]:
    chain = await client.get_option_chain(f"{symbol}.US", expiry)
    if not chain:
        return iv_rank_value, [], False

    symbols_to_fetch = []
    for entry in chain:
        if params.side in ("both", "call") and entry.get("call_symbol"):
            symbols_to_fetch.append(entry["call_symbol"])
        if params.side in ("both", "put") and entry.get("put_symbol"):
            symbols_to_fetch.append(entry["put_symbol"])

    if not symbols_to_fetch:
        return iv_rank_value, [], False

    contracts = await client.get_option_quotes(
        symbols_to_fetch, price, symbol,
        max_moneyness=params.max_abs_delta,
        min_moneyness=params.min_otm,
        min_open_interest=params.min_open_interest,
    )

    if iv_rank_value is None and contracts:
        atm_contract = min(contracts, key=lambda c: abs(c.strike - price))
        if atm_contract.iv > 0 and candles:
            iv_rank_value = compute_iv_rank(atm_contract.iv, candles)
        if iv_rank_value is not None and iv_rank_value < params.min_iv_rank:
            return iv_rank_value, [], True

    return iv_rank_value, _filter_contracts(params, contracts, iv_rank_value), False


def _filter_contracts(
    params: ScreenParams,
    contracts: list[OptionContract],
    iv_rank_value: float | None,
) -> list[ScreenResult]:
    results: list[ScreenResult] = []
    for contract in contracts:
        if contract.dte < 0:
            continue

        liquid, reason = is_liquid(
            contract.bid,
            contract.ask,
            contract.open_interest,
            min_open_interest=params.min_open_interest,
            max_spread_ratio=params.max_spread_ratio,
        )
        if not liquid:
            continue

        if abs(contract.delta) >= params.max_abs_delta:
            continue

        if params.min_otm > 0:
            if contract.side == "call" and (contract.strike - contract.underlying_price) / contract.underlying_price < params.min_otm:
                continue
            if contract.side == "put" and (contract.underlying_price - contract.strike) / contract.underlying_price < params.min_otm:
                continue

        ann_ret = annualized_return(
            contract.side,
            contract.mid,
            contract.strike,
            contract.underlying_price,
            contract.dte,
        )
        if ann_ret is None:
            continue

        if ann_ret < params.min_annual_return:
            continue

        pop_val = probability_of_profit(
            contract.side, contract.strike,
            contract.underlying_price, contract.iv, contract.dte,
        )
        if pop_val < params.min_pop:
            continue

        collateral = contract.strike if contract.side == "put" else contract.underlying_price
        ev = expected_value(pop_val, contract.mid, collateral)

        results.append(ScreenResult(
            underlying=contract.underlying,
            symbol=contract.symbol,
            side=contract.side,
            expiration=contract.expiration,
            dte=contract.dte,
            strike=contract.strike,
            bid=contract.bid,
            ask=contract.ask,
            mid=contract.mid,
            delta=contract.delta,
            iv=contract.iv,
            open_interest=contract.open_interest,
            volume=contract.volume,
            underlying_price=contract.underlying_price,
            premium=contract.mid,
            collateral=collateral,
            ann_return_pct=ann_ret,
            iv_rank=iv_rank_value if iv_rank_value is not None else 0.0,
            pop=pop_val,
            expected_value=ev,
        ))
    return results


async def run_screening(
    client: LongBridgeClient,
    params: ScreenParams,
    on_symbol_done: SymbolDoneCallback | None = None,
) -> list[ScreenResult]:
    if params.pre_market:
        params.min_otm = params.min_otm / 3.0
        params.max_abs_delta = params.max_abs_delta * 3.0

    tasks = [
        _screen_symbol(client, params, symbol, on_symbol_done=on_symbol_done)
        for symbol in params.symbols
    ]
    per_symbol_results = await asyncio.gather(*tasks)
    results: list[ScreenResult] = [r for batch in per_symbol_results for r in batch]
    results.sort(key=lambda r: r.ann_return_pct, reverse=True)
    return results
