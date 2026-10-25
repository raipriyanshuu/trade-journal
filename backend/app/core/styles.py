"""Trade styles (Scalp / Intraday / Swing / Positional + the user's own).

The list lives in the "trade_styles" setting. A style typed on a trade is
matched case-insensitively to an existing one ("swing" -> "Swing"); a new name
is added to the list so it shows up everywhere (pickers, filters, breakdowns).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Setting

DEFAULT_STYLES = ["Scalp", "Intraday", "Swing", "Positional"]


def get_styles(db: Session) -> list[str]:
    s = db.get(Setting, "trade_styles")
    styles = s.value if s and isinstance(s.value, list) else list(DEFAULT_STYLES)
    return [x for x in styles if isinstance(x, str) and x.strip()]


def normalize_style(db: Session, value: str | None) -> str | None:
    if value is None:
        return None
    name = " ".join(str(value).split())
    if not name:
        return None
    styles = get_styles(db)
    for existing in styles:
        if existing.lower() == name.lower():
            return existing
    s = db.get(Setting, "trade_styles")
    if s is None:
        db.add(Setting(key="trade_styles", value=styles + [name]))
    else:
        s.value = styles + [name]  # reassign so the JSON column is marked dirty
    return name
