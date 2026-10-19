import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../lib/api";
import AnalyticsFilterBar, { AnalyticsFilters } from "../components/AnalyticsFilterBar";
import { formatMoney, formatDuration } from "../lib/format";

const POS = "#22c58b";
const NEG = "#f0566b";
const ACCENT = "#6d6bf6";
const GRID = "#232b3b";

export default function Dashboard() {
  const [filters, setFilters] = useState<AnalyticsFilters>({ include_demo: true });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.dashboard(filters as any).then(setData).finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  const k = data?.kpis;
  const ccy = filters.currency ?? (k && Object.keys(k.net_by_ccy ?? {})[0]) ?? "USD";

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Dashboard</h1>
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      {loading || !data ? (
        <p className="text-ink-muted text-sm">Loading&hellip;</p>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            <Kpi label="Net P&L" value={netStr(k.net_by_ccy)} big />
            <Kpi label="Trades" value={k.trades} />
            <Kpi label="Win rate" value={`${Math.round(k.win_rate * 100)}%`} />
            <Kpi label="Profit factor" value={k.profit_factor ?? "∞"} />
            <Kpi label="Expectancy" value={formatMoney(k.expectancy, ccy)} />
            <Kpi label="Expectancy R" value={k.expectancy_r ?? "—"} />
            <Kpi label="Avg win" value={formatMoney(k.avg_win, ccy)} cls="text-pos" />
            <Kpi label="Avg loss" value={formatMoney(k.avg_loss, ccy)} cls="text-neg" />
            <Kpi label="Avg W/L" value={k.avg_win_loss_ratio ?? "—"} />
            <Kpi label="Max DD" value={`${formatMoney(k.max_drawdown, ccy)} (${k.max_drawdown_pct}%)`} cls="text-neg" />
            <Kpi label="Largest win" value={formatMoney(k.largest_win, ccy)} cls="text-pos" />
            <Kpi label="Largest loss" value={formatMoney(k.largest_loss, ccy)} cls="text-neg" />
            <Kpi label="Win streak" value={`${k.current_win_streak} (best ${k.longest_win_streak})`} />
            <Kpi label="Loss streak" value={`${k.current_loss_streak} (worst ${k.longest_loss_streak})`} />
            <Kpi label="Hold (win)" value={formatDuration(k.avg_hold_winner ? Math.round(k.avg_hold_winner) : null)} />
            <Kpi label="Hold (loss)" value={formatDuration(k.avg_hold_loser ? Math.round(k.avg_hold_loser) : null)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Cumulative P&L">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.equity}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={POS} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={POS} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="date" hide />
                  <YAxis tick={{ fill: "#6b7688", fontSize: 10 }} width={52} />
                  <Tooltip contentStyle={tip} />
                  <Area type="monotone" dataKey="cumulative" stroke={POS} fill="url(#eq)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Drawdown">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.equity}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="date" hide />
                  <YAxis tick={{ fill: "#6b7688", fontSize: 10 }} width={52} />
                  <Tooltip contentStyle={tip} />
                  <Area type="monotone" dataKey="drawdown" stroke={NEG} fill={NEG} fillOpacity={0.2} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Daily P&L">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.daily_pnl}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7688", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#6b7688", fontSize: 10 }} width={52} />
                  <Tooltip contentStyle={tip} />
                  <Bar dataKey="net" radius={[3, 3, 0, 0]}>
                    {data.daily_pnl.map((d: any, i: number) => <Cell key={i} fill={d.net >= 0 ? POS : NEG} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="R-multiple distribution">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.r_distribution}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fill: "#6b7688", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7688", fontSize: 10 }} width={32} allowDecimals={false} />
                  <Tooltip contentStyle={tip} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {data.r_distribution.map((d: any, i: number) => <Cell key={i} fill={d.bucket.includes("-") && d.bucket.startsWith("<") || ["< -3", "-3..-2", "-2..-1", "-1..0"].includes(d.bucket) ? NEG : POS} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const tip = { background: "#141a27", border: "1px solid #232b3b", fontSize: 12 };

function netStr(byCcy: Record<string, string>): string {
  const entries = Object.entries(byCcy ?? {});
  if (entries.length === 0) return "—";
  return entries.map(([c, v]) => formatMoney(v, c)).join("  ");
}

function Kpi({ label, value, cls = "", big }: { label: string; value: React.ReactNode; cls?: string; big?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`${big ? "text-base" : "text-sm"} font-semibold mt-0.5 font-mono ${cls}`}>{value}</div>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}
