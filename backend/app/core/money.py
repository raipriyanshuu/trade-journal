"""Decimal money/price helpers. All rounding is explicit and half-up."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

TWO_DP = Decimal("0.01")
PRICE_DP = Decimal("0.00000001")  # 8 dp is plenty for prices / points


def q_money(value: Decimal | None) -> Decimal | None:
    """Quantize a cash amount to 2 decimal places."""
    if value is None:
        return None
    return value.quantize(TWO_DP, rounding=ROUND_HALF_UP)


def q_price(value: Decimal | None) -> Decimal | None:
    """Quantize a price/points value, trimming trailing noise from division."""
    if value is None:
        return None
    q = value.quantize(PRICE_DP, rounding=ROUND_HALF_UP)
    # Normalize to drop trailing zeros but keep at least an integer form.
    normalized = q.normalize()
    # Avoid scientific notation like 5E+1 for whole numbers.
    if normalized == normalized.to_integral():
        return normalized.quantize(Decimal("1"))
    return normalized
