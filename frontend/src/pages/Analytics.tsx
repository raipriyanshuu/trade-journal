import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import AnalyticsFilterBar, { AnalyticsFilters } from "../components/AnalyticsFilterBar";

const DIM_LABELS: Record<string, string> = {
  instrument: "Instrument", account: "Account", direction: "Direction",
  session_time: "Time in session", clock_time: "Clock time (IST)", weekday: "Day of week",
  setup_tag: "Trade type", location: "Entry location", probability: "Probability", thesis: "What happened",
  entry_quality: "Entry quality", exit_quality: "Exit quality", htf_alignment: "HTF alignment",
  with_htf: "With vs against HTF", atr_used: "ATR used at entry", mistake_tag: "Mistake tag",
  scenario: "Scenario", planned: "Planned vs unplanned",
  checklist_score: "Checklist score", vwap: "VWAP relation", entry_location: "Level type (legacy)",
  day_type: "Day type", opening_type: "Opening type", holding_bucket: "Holding time",
  position_size: "Position size",
};

const POS = "#22c58b";
const NEG = "#f0566b";
const GRID = "#232b3b";

export default function Analytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>({ include_demo: true });
  const [dims, setDims] = useState<string[]>([]);
  const [dim, setDim] = useState("setup_tag");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.breakdown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.dimensions().then(setDims); }, []);
  useEffect(() => {
    setLoading(true);
    api.breakdown(dim, filters as any).then(setRows).finally(() => setLoading(false));
  }, [dim, JSON.stringify(filters)]);

  const chartData = rows.map((r) => ({ key: r.key, net: Number(r.net_pnl) }));

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Breakdowns</h1>
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      <div className="flex flex-wrap gap-1 mb-4">
        {dims.map((d) => (
          <button key={d} onClick={() => setDim(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dim === d ? "bg-accent/20 text-ink" : "bg-card-hover text-ink-muted hover:text-ink"}`}>
            {DIM_LABELS[d] ?? d}
          </button>
        ))}
      </div>

      {loading ? <p className="text-ink-muted text-sm">Loading&hellip;</p> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint border-b border-card-border">
                  <th className="px-3 py-2 font-medium">{DIM_LABELS[dim] ?? dim}</th>
                  <th className="px-3 py-2 font-medium text-right">Trades</th>
                  <th className="px-3 py-2 font-medium text-right">Win%</th>
                  <th className="px-3 py-2 font-medium text-right">Net</th>
                  <th className="px-3 py-2 font-medium text-right">Avg</th>
                  <th className="px-3 py-2 font-medium text-right">PF</th>
                  <th className="px-3 py-2 font-medium text-right">Exp R</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-card-border/40">
                    <td className="px-3 py-2 font-medium">{r.key}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.trades}</td>
                    <td className="px-3 py-2 text-right font-mono">{Math.round(r.win_rate * 100)}%</td>
                    <td className={`px-3 py-2 text-right font-mono ${Number(r.net_pnl) < 0 ? "text-neg" : "text-pos"}`}>{r.net_pnl}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{r.avg_pnl}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{r.profit_factor ?? "∞"}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{r.expectancy_r ?? "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No data.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card p-4">
            <h3 className="font-medium text-sm mb-3">Net P&amp;L by {DIM_LABELS[dim] ?? dim}</h3>
            <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 28)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "#6b7688", fontSize: 10 }} />
                <YAxis type="category" dataKey="key" tick={{ fill: "#9aa6b8", fontSize: 11 }} width={90} />
                <Tooltip contentStyle={{ background: "#141a27", border: "1px solid #232b3b", fontSize: 12 }} />
                <Bar dataKey="net" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.net >= 0 ? POS : NEG} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
