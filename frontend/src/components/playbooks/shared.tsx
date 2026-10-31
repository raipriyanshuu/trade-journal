import { useEffect, useState } from "react";
import { api, Playbook, PlaybookRule } from "../../lib/api";

export const PLAYBOOK_COLORS = ["violet", "blue", "teal", "green", "amber", "orange", "red", "pink", "gray"] as const;

// Full class strings so Tailwind keeps them.
const TONE: Record<string, { chip: string; dot: string; bar: string }> = {
  violet: { chip: "bg-violet-500/15 text-violet-300", dot: "bg-violet-400", bar: "bg-violet-400" },
  blue: { chip: "bg-sky-500/15 text-sky-300", dot: "bg-sky-400", bar: "bg-sky-400" },
  teal: { chip: "bg-teal-500/15 text-teal-300", dot: "bg-teal-400", bar: "bg-teal-400" },
  green: { chip: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-400", bar: "bg-emerald-400" },
  amber: { chip: "bg-amber-500/15 text-amber-300", dot: "bg-amber-400", bar: "bg-amber-400" },
  orange: { chip: "bg-orange-500/15 text-orange-300", dot: "bg-orange-400", bar: "bg-orange-400" },
  red: { chip: "bg-neg/15 text-neg", dot: "bg-neg", bar: "bg-neg" },
  pink: { chip: "bg-pink-500/15 text-pink-300", dot: "bg-pink-400", bar: "bg-pink-400" },
  gray: { chip: "bg-card-border text-ink-muted", dot: "bg-ink-faint", bar: "bg-ink-faint" },
};
export const tone = (color: string | undefined) => TONE[color ?? "violet"] ?? TONE.violet;

export const DEFAULT_SECTIONS = ["Market context", "Entry criteria", "Exit criteria", "Risk management"];

/** Starting points for a new playbook; every rule can be edited or removed. */
export const TEMPLATES: { name: string; description: string; color: string; rules: PlaybookRule[] }[] = [
  { name: "Blank", description: "", color: "violet", rules: [] },
  {
    name: "Breakout and retest", description: "Trade the first pullback after a clean break of balance.", color: "teal",
    rules: [
      { section: "Market context", text: "Higher-timeframe trend agrees with the trade" },
      { section: "Market context", text: "Price was balancing / consolidating before the break" },
      { section: "Entry criteria", text: "Clean break of the range with volume" },
      { section: "Entry criteria", text: "Retest of the broken level holds" },
      { section: "Exit criteria", text: "Stop beyond the retest low / high" },
      { section: "Exit criteria", text: "Partial at 1R, runner to the next level" },
      { section: "Risk management", text: "Risk within my per-trade limit" },
    ],
  },
  {
    name: "VWAP mean reversion", description: "Fade an overextended move back to VWAP.", color: "amber",
    rules: [
      { section: "Market context", text: "Balanced / rotational day, not a trend day" },
      { section: "Entry criteria", text: "Price at or beyond the 2-sigma VWAP band" },
      { section: "Entry criteria", text: "Absorption or failed continuation at the extreme" },
      { section: "Exit criteria", text: "Target VWAP" },
      { section: "Risk management", text: "No entries in the first 15 minutes" },
    ],
  },
  {
    name: "Opening drive", description: "Join a strong one-directional open.", color: "blue",
    rules: [
      { section: "Market context", text: "Open outside yesterday's value area" },
      { section: "Entry criteria", text: "No return into the opening range" },
      { section: "Entry criteria", text: "First pullback holds VWAP" },
      { section: "Exit criteria", text: "Exit if price re-enters the opening range" },
    ],
  },
];

/** Playbooks for pickers. */
export function usePlaybooks() {
  const [list, setList] = useState<Playbook[]>([]);
  // Archived ones are loaded too, so a trade that uses one still shows its checklist.
  const reload = () => api.listPlaybooks({ include_archived: true }).then(setList).catch(() => {});
  useEffect(() => { reload(); }, []);
  return { playbooks: list, reload };
}

export function PlaybookBadge({ pb, followed, total }: {
  pb: { name: string; color: string } | null | undefined; followed?: number | null; total?: number | null;
}) {
  if (!pb) return <span className="text-ink-faint">&mdash;</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`badge ${tone(pb.color).chip}`}>{pb.name}</span>
      {total ? <span className="text-[11px] text-ink-faint font-mono">{followed ?? 0}/{total}</span> : null}
    </span>
  );
}

export function sectionsOf(rules: PlaybookRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) if (!out.includes(r.section)) out.push(r.section);
  return out;
}

/** Tick the rules you followed on a trade. */
export function RuleChecklist({ playbook, checked, onChange, compact }: {
  playbook: Playbook;
  checked: number[];
  onChange: (ids: number[]) => void;
  compact?: boolean;
}) {
  const ids = playbook.rules.map((r) => r.id!).filter((x) => x !== undefined);
  const done = ids.filter((id) => checked.includes(id)).length;
  const pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
  const toggle = (id: number) => onChange(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  if (ids.length === 0) {
    return <p className="text-xs text-ink-faint">This playbook has no rules yet. Add them on the Playbooks page.</p>;
  }
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-ink-muted">Rules followed</span>
        <button type="button" className="text-accent-soft hover:underline"
          onClick={() => onChange(done === ids.length ? [] : ids)}>
          {done === ids.length ? "Uncheck all" : "Check all"}
        </button>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 rounded-full bg-card-border overflow-hidden">
          <div className={`h-full rounded-full ${pct === 100 ? "bg-pos" : pct >= 50 ? "bg-warn" : "bg-neg"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-mono">{done} / {ids.length}</span>
      </div>
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {sectionsOf(playbook.rules).map((sec) => (
          <div key={sec}>
            <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">{sec}</div>
            <div className="space-y-1">
              {playbook.rules.filter((r) => r.section === sec).map((r) => (
                <label key={r.id} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-0.5 accent-[rgb(var(--tj-accent))]" checked={checked.includes(r.id!)} onChange={() => toggle(r.id!)} />
                  <span className={checked.includes(r.id!) ? "text-ink" : "text-ink-muted"}>{r.text}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Playbook dropdown + checklist (used in the log form and on the trade page). */
export function PlaybookPicker({ playbooks, playbookId, checked, onChange }: {
  playbooks: Playbook[];
  playbookId: number | null;
  checked: number[];
  onChange: (playbookId: number | null, checked: number[]) => void;
}) {
  const pb = playbooks.find((p) => p.id === playbookId) ?? null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {pb && <span className={`w-2.5 h-2.5 rounded-full ${tone(pb.color).dot}`} />}
        <select className="input !py-1.5" value={playbookId ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, [])}>
          <option value="">No playbook</option>
          {playbooks.filter((p) => !p.archived || p.id === playbookId).map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.archived ? " (archived)" : ""}</option>
          ))}
        </select>
      </div>
      {pb && <RuleChecklist playbook={pb} checked={checked} onChange={(ids) => onChange(pb.id, ids)} compact />}
    </div>
  );
}
