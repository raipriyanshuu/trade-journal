import { Tag } from "../../lib/api";

// Notion-style taxonomy. "setup" is labelled "Trade type" everywhere in the UI.
export const CATEGORY_LABELS: Record<string, string> = {
  setup: "Trade type",
  location: "Entry location",
  probability: "Probability",
  thesis: "What happened",
  mistake: "Mistakes",
  emotion: "Emotion",
  custom: "Custom",
};

export const JOURNAL_CATEGORIES = ["setup", "location", "probability", "thesis", "mistake"];

const CATEGORY_TONE: Record<string, string> = {
  setup: "bg-amber-500/15 text-amber-300",
  location: "bg-violet-500/15 text-violet-300",
  probability: "bg-orange-500/15 text-orange-300",
  thesis: "bg-emerald-500/15 text-emerald-300",
  mistake: "bg-neg/15 text-neg",
  emotion: "bg-sky-500/15 text-sky-300",
  custom: "bg-card-border text-ink-muted",
};

/** Tone for a single tag; "What happened" chips go red when the thesis failed. */
export function chipTone(tag: Tag): string {
  if (tag.category === "thesis" && /stop|wrong|revers/i.test(tag.name)) return "bg-neg/15 text-neg";
  return CATEGORY_TONE[tag.category] ?? CATEGORY_TONE.custom;
}

export function TagChips({ tags, category, max = 4 }: { tags: Tag[]; category?: string; max?: number }) {
  const list = category ? tags.filter((t) => t.category === category) : tags;
  if (list.length === 0) return <span className="text-ink-faint">&mdash;</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.slice(0, max).map((t) => (
        <span key={t.id} className={`badge whitespace-nowrap ${chipTone(t)}`}>{t.name}</span>
      ))}
      {list.length > max && <span className="text-xs text-ink-faint">+{list.length - max}</span>}
    </div>
  );
}

export function ChipPicker({
  tags, category, selected, onToggle,
}: {
  tags: Tag[];
  category: string;
  selected: number[];
  onToggle: (id: number) => void;
}) {
  const list = tags.filter((t) => t.category === category);
  if (list.length === 0) return null;
  return (
    <div>
      <label className="label">{CATEGORY_LABELS[category] ?? category}</label>
      <div className="flex flex-wrap gap-1.5">
        {list.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button key={t.id} type="button" onClick={() => onToggle(t.id)}
              className={`badge transition ${on ? chipTone(t) + " ring-1 ring-current" : "bg-card-hover text-ink-faint hover:text-ink"}`}>
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const GRADES = ["A+", "A", "B", "C"];
const GRADE_TONE: Record<string, string> = {
  "A+": "bg-amber-400/20 text-amber-300",
  A: "bg-pos/20 text-pos",
  B: "bg-sky-500/20 text-sky-300",
  C: "bg-neg/20 text-neg",
};

export function gradeTone(g: string | null | undefined): string {
  return g ? GRADE_TONE[g] ?? "bg-card-border text-ink-muted" : "";
}

export function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="text-ink-faint">&mdash;</span>;
  return <span className={`badge font-semibold ${gradeTone(grade)}`}>{grade}</span>;
}

export function GradePicker({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-1">
        {GRADES.map((g) => (
          <button key={g} type="button" onClick={() => onChange(value === g ? null : g)}
            className={`btn !px-2.5 !py-1 text-xs font-semibold ${value === g ? gradeTone(g) : "bg-card-hover text-ink-faint"}`}>
            {g}
          </button>
        ))}
      </div>
    </div>
  );
}

const HTF = [
  { key: "bullish", label: "Bullish", tone: "bg-pos/20 text-pos" },
  { key: "bearish", label: "Bearish", tone: "bg-neg/20 text-neg" },
  { key: "range", label: "Range", tone: "bg-sky-500/20 text-sky-300" },
];

export function htfTone(v: string | null | undefined) {
  return HTF.find((h) => h.key === v)?.tone ?? "";
}

export function HtfBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-ink-faint">&mdash;</span>;
  return <span className={`badge capitalize ${htfTone(value)}`}>{value}</span>;
}

export function HtfPicker({ label = "HTF alignment", value, onChange, big }: {
  label?: string; value: string | null | undefined; onChange: (v: string | null) => void; big?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-1">
        {HTF.map((h) => (
          <button key={h.key} type="button" onClick={() => onChange(value === h.key ? null : h.key)}
            className={`btn flex-1 ${big ? "!py-2.5" : "!py-1 text-xs"} ${value === h.key ? h.tone : "bg-card-hover text-ink-faint"}`}>
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ResultBadge({ result, partial }: { result: string; partial?: boolean }) {
  const tone: Record<string, string> = {
    win: "bg-pos/15 text-pos", loss: "bg-neg/15 text-neg", breakeven: "bg-card-border text-ink-muted",
    open: "bg-accent/15 text-accent-soft", missed: "bg-violet-500/15 text-violet-300",
  };
  const label: Record<string, string> = { win: "Win", loss: "Loss", breakeven: "Breakeven", open: "Open", missed: "Missed" };
  return (
    <span className="inline-flex gap-1">
      {partial && <span className="badge bg-sky-500/15 text-sky-300">Partial</span>}
      <span className={`badge ${tone[result] ?? ""}`}>{label[result] ?? result}</span>
    </span>
  );
}
