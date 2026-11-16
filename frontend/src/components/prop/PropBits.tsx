import { PropLevel, PropRule } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { STATUS_LABEL } from "../settings/AccountsTab";

export const LEVEL_TEXT: Record<PropLevel, string> = {
  ok: "text-pos", caution: "text-ink", warning: "text-warn", danger: "text-neg", breached: "text-neg",
};
const LEVEL_BAR: Record<PropLevel, string> = {
  ok: "bg-pos", caution: "bg-accent", warning: "bg-warn", danger: "bg-neg", breached: "bg-neg",
};
export const LEVEL_BORDER: Record<PropLevel, string> = {
  ok: "border-card-border", caution: "border-card-border", warning: "border-warn/60", danger: "border-neg/70",
  breached: "border-neg",
};

const STATUS_TONE: Record<string, string> = {
  in_progress: "bg-accent/15 text-accent-soft",
  passed: "bg-pos/15 text-pos",
  funded: "bg-pos/15 text-pos",
  failed: "bg-neg/15 text-neg",
  closed: "bg-card-border text-ink-faint",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? "bg-card-border text-ink-muted"}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** A thin progress bar. `fraction` is 0..1 (clamped); `tone` picks the colour. */
export function Meter({ fraction, tone }: { fraction: number; tone: PropLevel | "target" }) {
  const w = Math.max(0, Math.min(1, fraction)) * 100;
  const cls = tone === "target" ? "bg-pos" : LEVEL_BAR[tone];
  return (
    <div className="h-1.5 rounded-full bg-card-border overflow-hidden">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/** How far along a rule is, for its bar (target and days fill up; limits fill as you use them). */
export function ruleFraction(r: PropRule): number {
  if (r.key === "target" || r.key === "days") return r.limit ? Math.max(0, Number(r.value ?? 0)) / r.limit : 0;
  return r.used ?? 0;
}

export function ruleTone(r: PropRule): PropLevel | "target" {
  if (r.key === "target" || r.key === "days") return r.level === "ok" ? "ok" : "target";
  return r.level;
}

export function ruleText(r: PropRule, ccy: string): string {
  const m = (v: number | null) => formatMoney(v, ccy);
  switch (r.key) {
    case "target":
      return `${m(r.value)} of ${m(r.limit)}`;
    case "daily_loss":
      return `${m(r.value)} today · limit −${m(r.limit)}`;
    case "drawdown":
      return `${m(r.value)} above the floor · max ${m(r.limit)}`;
    case "consistency":
      if (r.value == null) return `no profit yet · limit ${r.limit}%`;
      if (r.value > 100) return `best day is more than total profit · limit ${r.limit}%`;
      return `best day ${Math.round(r.value)}% of profit · limit ${r.limit}%`;
    case "days":
      return `${r.value} of ${r.limit} days`;
    case "contracts":
      return `${r.value} used · limit ${r.limit}`;
    default:
      return `${r.value ?? "—"} / ${r.limit ?? "—"}`;
  }
}

export function RuleRow({ r, ccy }: { r: PropRule; ccy: string }) {
  const tone = ruleTone(r);
  const done = (r.key === "target" || r.key === "days") && r.level === "ok";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs mb-1">
        <span className="text-ink-muted">{r.label}</span>
        <span className={`font-mono ${done ? "text-pos" : tone === "target" ? "text-ink" : LEVEL_TEXT[r.level]}`}>
          {done ? "✓ " : r.level === "breached" ? "✕ " : ""}
          {ruleText(r, ccy)}
        </span>
      </div>
      <Meter fraction={ruleFraction(r)} tone={tone} />
    </div>
  );
}

const ORDER: PropLevel[] = ["ok", "caution", "warning", "danger", "breached"];
/** Colour for "can lose today": the tighter of the daily-loss and drawdown rules. */
export function lossLevel(rules: PropRule[]): PropLevel {
  return rules.filter((r) => r.key === "daily_loss" || r.key === "drawdown")
    .reduce<PropLevel>((w, r) => (ORDER.indexOf(r.level) > ORDER.indexOf(w) ? r.level : w), "ok");
}
