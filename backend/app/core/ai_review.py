"""Optional AI weekly review via the Claude API.

Off by default (one of two opt-in network features, with delayed CME charts).
Sends an anonymized summary
of a report (no account names or ids, no notes text) and returns a written review.
"""

from __future__ import annotations

import json

import anthropic

DEFAULT_MODEL = "claude-opus-5-5"
# Models that accept server-side refusal fallbacks ("default" routing).
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

SYSTEM_PROMPT = (
    "You are a trading performance coach reviewing one trader's journal statistics. "
    "The trader trades index and commodity futures (CME and Indian markets) using "
    "orderflow and Market Profile / auction-market concepts. You receive a JSON "
    "summary of one week or month: KPIs vs the previous period, best and worst setups, "
    "costliest mistakes, rule violations, missed setups, journal discipline and a "
    "rule-based suggested focus.\n\n"
    "Write a concise review in Markdown with these sections: **What went well**, "
    "**What cost you**, **Patterns to watch**, and **One focus for next period**. "
    "Ground every point in the numbers provided and quote them; do not invent data. "
    "This is a performance review, not investment advice: do not recommend specific "
    "trades, instruments or position sizes."
)


class AIReviewError(Exception):
    pass


def anonymize(report: dict) -> dict:
    """Keep statistics only; drop free text that could identify accounts or people."""
    keep = ("period", "start", "end", "kpis", "previous_kpis", "compare", "best_setups",
            "worst_setups", "top_mistakes", "mistake_rate", "missed", "clean_streak",
            "rule_violations", "violations_by_rule", "focus")
    out = {k: report.get(k) for k in keep}
    disc = dict(report.get("discipline") or {})
    disc.pop("lessons", None)
    out["discipline"] = disc
    return out


def review(report: dict, cfg: dict) -> dict:
    if not cfg.get("enabled"):
        raise AIReviewError("AI review is turned off. Enable it in Settings → AI review.")
    api_key = (cfg.get("api_key") or "").strip()
    if not api_key:
        raise AIReviewError("Add your Anthropic API key in Settings → AI review.")
    model = (cfg.get("model") or DEFAULT_MODEL).strip()

    client = anthropic.Anthropic(api_key=api_key)
    payload = json.dumps(anonymize(report), default=str, indent=1)
    kwargs = dict(
        model=model,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Here is my trading summary:\n\n{payload}"}],
    )
    try:
        if model in _FALLBACK_MODELS:
            # Server-side refusal fallback: if a safety classifier declines, the
            # API retries on a suitable model inside the same call.
            response = client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
            )
        else:
            response = client.messages.create(**kwargs)
    except anthropic.AuthenticationError:
        raise AIReviewError("The Anthropic API key was rejected. Check it in Settings.")
    except anthropic.PermissionDeniedError:
        raise AIReviewError("This API key does not have access to that model.")
    except anthropic.NotFoundError:
        raise AIReviewError(f"Model '{model}' was not found. Check the model id in Settings.")
    except anthropic.RateLimitError:
        raise AIReviewError("Rate limited by the Claude API. Try again in a minute.")
    except anthropic.APIStatusError as e:
        raise AIReviewError(f"Claude API error ({e.status_code}): {e.message}")
    except anthropic.APIConnectionError:
        raise AIReviewError("Could not reach the Claude API. Check your internet connection.")

    if response.stop_reason == "refusal":
        raise AIReviewError("The model declined to write this review.")
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        raise AIReviewError("The model returned an empty review.")
    return {
        "model": response.model,
        "review": text,
        "truncated": response.stop_reason == "max_tokens",
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
