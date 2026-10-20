"""Optional Indian charges calculator for NSE / MCX futures.

Rates come from the `india_charges` setting and are seeded unverified -- confirm
them against a contract note. Contract value = price x point value x lots.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

D = Decimal
TWO = D("0.01")


def _pct(v) -> Decimal:
    return D(str(v)) / D("100")


def estimate(cfg: dict, buy_values: list[Decimal], sell_values: list[Decimal]) -> dict:
    """Charges for one trade. Each list holds the contract value of one order."""
    per_order = D(str(cfg.get("brokerage_per_order", "20")))
    brk_pct = _pct(cfg.get("brokerage_pct", "0.03"))
    brokerage = sum((min(per_order, v * brk_pct) for v in buy_values + sell_values), D("0"))

    buy_total = sum(buy_values, D("0"))
    sell_total = sum(sell_values, D("0"))
    turnover = buy_total + sell_total

    stt = sell_total * _pct(cfg.get("stt_sell_pct", "0.02"))
    exchange = turnover * _pct(cfg.get("exchange_pct", "0.00173"))
    sebi = turnover * D(str(cfg.get("sebi_per_crore", "10"))) / D("10000000")
    stamp = buy_total * _pct(cfg.get("stamp_buy_pct", "0.002"))
    gst = (brokerage + exchange + sebi) * _pct(cfg.get("gst_pct", "18"))

    parts = {"brokerage": brokerage, "stt_ctt": stt, "exchange": exchange,
             "sebi": sebi, "stamp_duty": stamp, "gst": gst}
    total = sum(parts.values(), D("0"))
    return {
        **{k: str(v.quantize(TWO, ROUND_HALF_UP)) for k, v in parts.items()},
        "turnover": str(turnover.quantize(TWO, ROUND_HALF_UP)),
        "total": str(total.quantize(TWO, ROUND_HALF_UP)),
    }
