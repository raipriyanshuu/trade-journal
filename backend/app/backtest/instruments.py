"""Instruments available for backtesting and the timeframe tables."""

from __future__ import annotations

INSTRUMENTS: dict[str, dict] = {
    "ES": {"name": "E-mini S&P 500", "yahoo": "ES=F", "tick": 0.25, "point_value": 50.0,
           "micro": "MES", "micro_point_value": 5.0, "fee_full": 4.5, "fee_micro": 1.5},
    "NQ": {"name": "E-mini Nasdaq-100", "yahoo": "NQ=F", "tick": 0.25, "point_value": 20.0,
           "micro": "MNQ", "micro_point_value": 2.0, "fee_full": 4.5, "fee_micro": 1.5},
    "GC": {"name": "Gold", "yahoo": "GC=F", "tick": 0.1, "point_value": 100.0,
           "micro": "MGC", "micro_point_value": 10.0, "fee_full": 4.5, "fee_micro": 1.5},
    "CL": {"name": "Crude oil (WTI)", "yahoo": "CL=F", "tick": 0.01, "point_value": 1000.0,
           "micro": "MCL", "micro_point_value": 100.0, "fee_full": 4.5, "fee_micro": 1.5},
}

# Stored base timeframes, finest first, with each bar's duration in seconds.
# A daily bar spans the CME session, 18:00 -> 17:00 New York (23 hours), so it
# never reaches into the next session, even on daylight-saving change days.
BASES: dict[str, int] = {"5m": 300, "1h": 3600, "1d": 82800}

# Chart timeframes (seconds) and the base timeframes each one can be built from,
# finest first. Finer bases give finer replay steps where they have data.
TIMEFRAMES: dict[str, int] = {
    "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1D": 86400, "1W": 604800,
}
TF_BASES: dict[str, list[str]] = {
    "5m": ["5m"], "15m": ["5m"], "30m": ["5m"],
    "1h": ["5m", "1h"], "4h": ["5m", "1h"],
    "1D": ["1h", "1d"], "1W": ["1d"],
}
INTRADAY = {"5m", "15m", "30m", "1h", "4h"}


def contract_spec(symbol: str, contract: str) -> dict:
    inst = INSTRUMENTS[symbol]
    micro = contract == "micro"
    return {
        "point_value": inst["micro_point_value"] if micro else inst["point_value"],
        "tick_size": inst["tick"],
        "fee_per_contract": inst["fee_micro"] if micro else inst["fee_full"],
        "label": inst["micro"] if micro else symbol,
    }
