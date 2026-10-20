import { useReference } from "../lib/useReference";

export interface AnalyticsFilters {
  account_id?: number;
  instrument_id?: number;
  date_from?: string;
  date_to?: string;
  currency?: string;
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
  function set<K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) {
    onChange({ ...filters, [k]: v === "" || v === undefined ? undefined : v });
  }
  return (
    <div className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
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
