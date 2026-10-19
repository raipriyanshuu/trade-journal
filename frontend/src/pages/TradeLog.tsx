import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, TradeFilters, TradeSummary } from "../lib/api";
import { useReference } from "../lib/useReference";
import { useConfig } from "../lib/config";
import { formatMoney, formatTimeOnly, pnlColor } from "../lib/format";
import ManualTradeForm from "../components/trades/ManualTradeForm";

const RESULT_BADGE: Record<string, string> = {
  win: "bg-pos/15 text-pos",
  loss: "bg-neg/15 text-neg",
  breakeven: "bg-card-border text-ink-muted",
  open: "bg-accent/15 text-accent-soft",
};

export default function TradeLog() {
  const nav = useNavigate();
  const { tz } = useConfig();
  const { accounts, instruments, tags } = useReference();
  const [filters, setFilters] = useState<TradeFilters>({ sort_by: "open_time", order: "desc" });
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkTagId, setBulkTagId] = useState<number | "">("");

  function toggleSel(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function applyBulkTag(mode: "add" | "remove") {
    if (!bulkTagId || selected.size === 0) return;
    await api.bulkTag([...selected], mode === "add" ? [Number(bulkTagId)] : [], mode === "remove" ? [Number(bulkTagId)] : []);
    setSelected(new Set());
    load();
  }

  function load() {
    setLoading(true);
    api
      .listTrades(filters)
      .then(setTrades)
      .then(() => setErr(null))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [JSON.stringify(filters)]);

  const totalsByCcy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of trades) m[t.currency] = (m[t.currency] ?? 0) + Number(t.net_pnl);
    return m;
  }, [trades]);

  function set<K extends keyof TradeFilters>(k: K, v: TradeFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v === "" ? undefined : v }));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Trade Log</h1>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New trade
        </button>
      </div>

      {/* Filter bar */}
      <div className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
        <FilterSelect label="Account" value={filters.account_id ?? ""} onChange={(v) => set("account_id", v ? Number(v) : undefined)}>
          <option value="">All</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Instrument" value={filters.instrument_id ?? ""} onChange={(v) => set("instrument_id", v ? Number(v) : undefined)}>
          <option value="">All</option>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>{i.symbol_root}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Direction" value={filters.direction ?? ""} onChange={(v) => set("direction", v)}>
          <option value="">All</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </FilterSelect>
        <FilterSelect label="Result" value={filters.result ?? ""} onChange={(v) => set("result", v)}>
          <option value="">All</option>
          <option value="win">Win</option>
          <option value="loss">Loss</option>
          <option value="breakeven">Breakeven</option>
          <option value="open">Open</option>
        </FilterSelect>
        <FilterSelect label="Source" value={filters.source ?? ""} onChange={(v) => set("source", v)}>
          <option value="">All</option>
          <option value="manual">Manual</option>
          <option value="import">Import</option>
          <option value="notion">Notion</option>
        </FilterSelect>
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={filters.date_from ?? ""} onChange={(e) => set("date_from", e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={filters.date_to ?? ""} onChange={(e) => set("date_to", e.target.value)} />
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-3 mb-3 text-sm">
        <span className="text-ink-muted">{trades.length} trades</span>
        {Object.entries(totalsByCcy).map(([ccy, sum]) => (
          <span key={ccy} className={`font-mono ${pnlColor(sum)}`}>
            {formatMoney(sum, ccy)}
          </span>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="card p-2 mb-3 flex items-center gap-2 text-sm bg-accent/10">
          <span className="text-ink">{selected.size} selected</span>
          <select className="input !w-auto !py-1" value={bulkTagId} onChange={(e) => setBulkTagId(Number(e.target.value))}>
            <option value="">Pick tag&hellip;</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
          </select>
          <button className="btn-ghost !py-1 text-xs" onClick={() => applyBulkTag("add")}>Add tag</button>
          <button className="btn-ghost !py-1 text-xs" onClick={() => applyBulkTag("remove")}>Remove tag</button>
          <button className="btn-ghost !py-1 text-xs ml-auto" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {err && <p className="text-neg text-sm mb-3">{err}</p>}

      {loading ? (
        <p className="text-ink-muted text-sm">Loading&hellip;</p>
      ) : trades.length === 0 ? (
        <div className="card p-10 text-center text-ink-muted">
          No trades match. Click <span className="text-ink">+ New trade</span> to add one.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium">Dir</th>
                <th className="px-3 py-2 font-medium text-right">Size</th>
                <th className="px-3 py-2 font-medium text-right">Entry</th>
                <th className="px-3 py-2 font-medium text-right">Exit</th>
                <th className="px-3 py-2 font-medium text-right">Pts</th>
                <th className="px-3 py-2 font-medium text-right">Net P&amp;L</th>
                <th className="px-3 py-2 font-medium text-right">R</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-card-border/50 hover:bg-card-hover cursor-pointer"
                  onClick={() => nav(`/trades/${t.id}`)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{t.trading_date}</td>
                  <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                    {t.time_known ? formatTimeOnly(t.open_time, tz) : "~"}
                  </td>
                  <td className="px-3 py-2 font-mono font-medium">
                    {t.symbol}
                    {t.is_demo && <span className="badge bg-accent/15 text-accent-soft ml-1">demo</span>}
                  </td>
                  <td className={`px-3 py-2 ${t.direction === "long" ? "text-pos" : "text-neg"}`}>
                    {t.direction === "long" ? "Long" : "Short"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{t.max_position_size}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.avg_entry ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.avg_exit ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.points ?? "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono ${pnlColor(t.net_pnl)}`}>
                    {formatMoney(t.net_pnl, t.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">
                    {t.r_multiple ? `${t.r_multiple}R` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`badge ${RESULT_BADGE[t.result] ?? ""}`}>{t.result}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {t.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag.id}
                          className={`badge ${tag.category === "mistake" ? "bg-neg/15 text-neg" : "bg-card-border text-ink-muted"}`}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ManualTradeForm
          onClose={() => setShowForm(false)}
          onCreated={(id) => {
            setShowForm(false);
            nav(`/trades/${id}`);
          }}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input !w-auto min-w-[110px]" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}
