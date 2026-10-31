"""Playbook logic: editing rules, ticking rules on trades, and playbook stats.

Rule adherence for a trade = rules ticked / rules the playbook has now. The
"followed vs broke" split compares trades where every rule was ticked against
trades where at least one was missed, which is the point of keeping a playbook.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.stats import basic_stats, classify, equity_and_drawdown
from app.models import Playbook, PlaybookRule, Trade, trade_rule_checks

DEFAULT_SECTIONS = ["Market context", "Entry criteria", "Exit criteria", "Risk management"]
ZERO = Decimal("0")


class PlaybookError(ValueError):
    pass


def sync_rules(db: Session, pb: Playbook, rules: list[dict]) -> None:
    """Make the playbook's rules match ``rules`` (in order).

    Items with an ``id`` update that rule; items without one are new; rules not
    in the list are deleted (their ticks on trades go with them).
    """
    existing = {r.id: r for r in pb.rules}
    keep: set[int] = set()
    for pos, item in enumerate(rules):
        text = " ".join(str(item.get("text") or "").split())
        if not text:
            continue
        section = " ".join(str(item.get("section") or "").split()) or "Entry criteria"
        rid = item.get("id")
        if rid is not None and rid in existing:
            r = existing[rid]
            r.text, r.section, r.position = text, section, pos
            keep.add(rid)
        elif rid is not None:
            raise PlaybookError(f"Rule {rid} doesn't belong to this playbook")
        else:
            pb.rules.append(PlaybookRule(text=text, section=section, position=pos))
    for rid, r in existing.items():
        if rid not in keep:
            pb.rules.remove(r)
            db.delete(r)


def rule_use_counts(db: Session, pb: Playbook) -> dict[int, int]:
    ids = [r.id for r in pb.rules]
    if not ids:
        return {}
    rows = db.execute(
        select(trade_rule_checks.c.rule_id, func.count())
        .where(trade_rule_checks.c.rule_id.in_(ids)).group_by(trade_rule_checks.c.rule_id)
    ).all()
    return {rid: n for rid, n in rows}


def set_trade_playbook(db: Session, trade: Trade, playbook_id: int | None, rule_ids: list[int] | None) -> None:
    """Assign a playbook to a trade and record the rules followed."""
    if playbook_id is not None:
        pb = db.get(Playbook, playbook_id)
        if pb is None:
            raise PlaybookError("Playbook not found")
        valid = {r.id for r in pb.rules}
        bad = [r for r in (rule_ids or []) if r not in valid]
        if bad:
            raise PlaybookError("Some ticked rules don't belong to that playbook")
    trade.playbook_id = playbook_id
    db.execute(delete(trade_rule_checks).where(trade_rule_checks.c.trade_id == trade.id))
    if playbook_id is not None:
        for rid in dict.fromkeys(rule_ids or []):
            db.execute(trade_rule_checks.insert().values(trade_id=trade.id, rule_id=rid))
    db.flush()
    db.expire(trade, ["checked_rules", "playbook"])


def adherence(trade: Trade, pb: Playbook) -> tuple[int, int]:
    """(rules ticked, rules in playbook) for a trade."""
    rule_ids = {r.id for r in pb.rules}
    ticked = sum(1 for r in trade.checked_rules if r.id in rule_ids)
    return ticked, len(rule_ids)


def _net_by_ccy(trades: list[Trade]) -> dict[str, str]:
    out: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for t in trades:
        if t.status == "closed" and t.pnl_known:
            out[t.currency] += Decimal(t.net_pnl)
    return {k: str(v) for k, v in out.items()}


def _brief(trades: list[Trade]) -> dict:
    s = basic_stats(trades)
    return {
        "trades": s["trades"], "win_rate": s["win_rate"], "profit_factor": s["profit_factor"],
        "expectancy": s["expectancy"], "expectancy_r": s["expectancy_r"],
        "net_by_ccy": _net_by_ccy(trades),
    }


def playbook_stats(pb: Playbook, trades: list[Trade], full: bool = False) -> dict:
    """Stats for one playbook from its trades (taken + missed)."""
    taken = [t for t in trades if t.status != "missed"]
    missed = [t for t in trades if t.status == "missed"]
    s = basic_stats(taken)
    pcts, all_followed, broke = [], [], []
    for t in taken:
        ticked, total = adherence(t, pb)
        if total:
            pcts.append(ticked / total)
            (all_followed if ticked == total else broke).append(t)
    out = {
        "trades": s["trades"],
        "open": sum(1 for t in taken if t.status == "open"),
        "missed": len(missed),
        "wins": s["wins"], "losses": s["losses"], "breakevens": s["breakevens"],
        "win_rate": s["win_rate"],
        "profit_factor": s["profit_factor"],
        "expectancy": s["expectancy"],
        "expectancy_r": s["expectancy_r"],
        "avg_win": s["avg_win"],
        "avg_loss": s["avg_loss"],
        "net_by_ccy": _net_by_ccy(taken),
        "adherence": round(sum(pcts) / len(pcts), 4) if pcts else None,
    }
    if not full:
        return out

    eq = equity_and_drawdown(taken)
    out.update({
        "largest_win": s["largest_win"],
        "largest_loss": s["largest_loss"],
        "max_drawdown": eq["max_drawdown"],
        "equity": eq["points"],
        "followed_all": _brief(all_followed),
        "broke_rules": _brief(broke),
    })
    # Per rule: how often it's followed, and results when followed vs not.
    per_rule = []
    closed = [t for t in taken if t.status == "closed"]
    for r in pb.rules:
        yes = [t for t in closed if any(c.id == r.id for c in t.checked_rules)]
        no = [t for t in closed if t not in yes]
        wr = lambda ts: (  # noqa: E731
            round(sum(1 for t in ts if classify(t) == "win") / len(ts), 4) if ts else None
        )
        per_rule.append({
            "rule_id": r.id, "section": r.section, "text": r.text,
            "followed": len(yes), "not_followed": len(no),
            "follow_rate": round(len(yes) / len(closed), 4) if closed else None,
            "win_rate_followed": wr(yes), "win_rate_not_followed": wr(no),
        })
    out["per_rule"] = per_rule
    return out


def serialize_playbook(pb: Playbook) -> dict:
    sections: list[str] = []
    for r in pb.rules:
        if r.section not in sections:
            sections.append(r.section)
    return {
        "id": pb.id, "name": pb.name, "description": pb.description, "color": pb.color,
        "archived": pb.archived,
        "rules": [{"id": r.id, "section": r.section, "text": r.text, "position": r.position} for r in pb.rules],
        "sections": sections,
    }
