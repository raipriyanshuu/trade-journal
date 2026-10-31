import { UNASSIGNED_STYLE } from "../lib/api";
import { styleTone, useStyles } from "../lib/useStyles";
import { useReference } from "../lib/useReference";
import { usePlaybooks } from "./playbooks/shared";

export interface AnalyticsFilters {
  account_id?: number;
  instrument_id?: number;
  date_from?: string;
  date_to?: string;
  currency?: string;
  style?: string;
  playbook?: string;
  include_demo?: boolean;
}

export default function AnalyticsFilterBar({
  filters,
  onChange,
}: {
  filters: AnalyticsFilters;
  onChange: (f: AnalyticsFilters) => void;
}) {
  const { accounts, instruments } = useReference();
  const { playbooks } = usePlaybooks();
  function set<K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) {
    onChange({ ...filters, [k]: v === "" || v === undefined ? undefined : v });
  }
  return (
    <div className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
      <StyleSwitch value={filters.style} onChange={(v) => set("style", v)} />
      <div>
        <label className="label">Account</label>
        <select className="input !w-auto" value={filters.account_id ?? ""} onChange={(e) => set("account_id", e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">All</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_demo ? " (demo)" : ""}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Instrument</label>
        <select className="input !w-auto" value={filters.instrument_id ?? ""} onChange={(e) => set("instrument_id", e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">All</option>
          {instruments.map((i) => <option key={i.id} value={i.id}>{i.symbol_root}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Playbook</label>
        <select className="input !w-auto" value={filters.playbook ?? ""} onChange={(e) => set("playbook", e.target.value)}>
          <option value="">All</option>
          {playbooks.map((p) => <option key={p.id} value={String(p.id)}>{p.name}{p.archived ? " (archived)" : ""}</option>)}
          <option value="none">No playbook</option>
        </select>
      </div>
      <div>
        <label className="label">Currency</label>
        <select className="input !w-auto" value={filters.currency ?? ""} onChange={(e) => set("currency", e.target.value)}>
          <option value="">All</option>
          <option value="USD">USD</option>
          <option value="INR">INR</option>
        </select>
      </div>
      <div>
        <label className="label">From</label>
        <input type="date" className="input" value={filters.date_from ?? ""} onChange={(e) => set("date_from", e.target.value)} />
      </div>
      <div>
        <label className="label">To</label>
        <input type="date" className="input" value={filters.date_to ?? ""} onChange={(e) => set("date_to", e.target.value)} />
      </div>
      <label className="flex items-center gap-1.5 text-sm text-ink-muted pb-2">
        <input type="checkbox" checked={filters.include_demo ?? true} onChange={(e) => set("include_demo", e.target.checked)} />
        Include demo
      </label>
    </div>
  );
}

/** Overall / Scalp / Swing / ... / Unassigned: scopes every stat on the page to one style. */
export function StyleSwitch({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const { styles } = useStyles();
  const opts: { key: string | undefined; label: string; tone: string }[] = [
    { key: undefined, label: "Overall", tone: "bg-accent/20 text-accent-soft" },
    ...styles.map((s) => ({ key: s, label: s, tone: styleTone(s) })),
    { key: UNASSIGNED_STYLE, label: "Unassigned", tone: "bg-card-border text-ink-muted" },
  ];
  return (
    <div className="w-full">
      <label className="label">Style</label>
      <div className="flex flex-wrap gap-1">
        {opts.map((o) => {
          const on = (value ?? undefined) === o.key;
          return (
            <button key={o.label} type="button" onClick={() => onChange(o.key)}
              className={`btn !py-1 !px-3 text-xs ${on ? o.tone + " ring-1 ring-current" : "bg-card-hover text-ink-faint hover:text-ink"}`}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
