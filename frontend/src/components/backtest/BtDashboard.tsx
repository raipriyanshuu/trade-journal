import { useEffect, useState } from "react";
import { useTheme } from "../../lib/theme";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { bt, BtSession, BtStats, GroupRow, money } from "../../lib/backtestApi";
import { formatDuration } from "../../lib/format";
import BtTradesTable from "./BtTradesTable";
import Lightbox from "../Lightbox";


/** Backtest results: KPIs, equity, strategy comparison and breakdowns. */
export default function BtDashboard({ sessions, strategies, refreshKey }: {
  sessions: BtSession[];
  strategies: string[];
  refreshKey: number;
}) {
  const { c } = useTheme();
  const POS = c.pos, NEG = c.neg, GRID = c.border, tip = c.tooltip;
  const [strategy, setStrategy] = useState("");
  const [symbol, setSymbol] = useState("");
  const [sessionId, setSessionId] = useState<number | "">("");
  const [data, setData] = useState<BtStats | null>(null);
  const [view, setView] = useState<number | null>(null);

  useEffect(() => {
    bt.stats({ strategy, symbol, session_id: sessionId === "" ? undefined : sessionId }).then(setData).catch(() => setData(null));
  }, [strategy, symbol, sessionId, refreshKey]);

  const k = data?.kpis ?? {};
  const symbols = [...new Set(sessions.map((s) => s.symbol))];
  const snaps = (data?.trades ?? []).filter((t) => t.snapshot);

  return (
    <div>
      <div className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
        <div>
          <label className="label">Strategy</label>
          <select className="input !w-auto" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="">All strategies</option>
            {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Instrument</label>
          <select className="input !w-auto" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="">All</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Session</label>
          <select className="input !w-auto" value={sessionId} onChange={(e) => setSessionId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">All sessions</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {!data ? <p className="text-sm text-ink-muted">Loading&hellip;</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            <Kpi label="Net P&L" value={money(k.net)} cls={(k.net ?? 0) >= 0 ? "text-pos" : "text-neg"} big />
            <Kpi label="Return" value={k.return_pct !== null && k.return_pct !== undefined ? `${k.return_pct}%` : "—"} />
            <Kpi label="Trades" value={k.trades} />
            <Kpi label="Win rate" value={`${Math.round((k.win_rate ?? 0) * 100)}%`} />
            <Kpi label="Profit factor" value={k.profit_factor ?? (k.trades ? "∞" : "—")} />
            <Kpi label="Expectancy" value={`${money(k.expectancy)} · ${k.expectancy_r ?? "—"}R`} />
            <Kpi label="Total R" value={k.total_r ?? "—"} />
            <Kpi label="Avg win / loss" value={`${money(k.avg_win)} / ${money(k.avg_loss)}`} />
            <Kpi label="Avg W/L ratio" value={k.avg_win_loss ?? "—"} />
            <Kpi label="Max drawdown" value={`${money(k.max_drawdown)} (${k.max_drawdown_pct}%)`} cls="text-neg" />
            <Kpi label="Streaks (W / L)" value={`${k.longest_win_streak} / ${k.longest_loss_streak}`} />
            <Kpi label="Avg hold" value={formatDuration(k.avg_hold_seconds ?? null)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className="card p-4 lg:col-span-2">
              <h3 className="font-medium text-sm mb-3">Equity curve <span className="text-ink-faint font-normal">(trade by trade)</span></h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.equity}>
                  <defs>
                    <linearGradient id="bteq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={POS} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={POS} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="n" tick={{ fill: c.faint, fontSize: 10 }} />
                  <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={64} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tip} formatter={(v: number) => money(v)} labelFormatter={(n) => `Trade #${n}`} />
                  <Area type="monotone" dataKey="equity" stroke={POS} fill="url(#bteq)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-4">
              <h3 className="font-medium text-sm mb-3">R-multiple distribution</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.r_distribution}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fill: c.faint, fontSize: 10 }} />
                  <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={28} allowDecimals={false} />
                  <Tooltip contentStyle={tip} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {data.r_distribution.map((d, i) => <Cell key={i} fill={d.bucket.startsWith("<") || d.bucket.startsWith("-") ? NEG : POS} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Group title="By strategy" rows={data.by_strategy} onPick={strategy ? undefined : setStrategy} />
            <Group title="By setup" rows={data.by_setup} />
            <Group title="By instrument" rows={data.by_symbol} />
            <Group title="Long vs short" rows={data.by_direction} />
            <Group title="By exit" rows={data.by_exit} />
            <Group title="By weekday (entry)" rows={data.by_weekday} />
            <Group title={`By hour of entry (${data.tz})`} rows={data.by_hour} />
          </div>

          <div className="card">
            <h3 className="font-medium text-sm px-4 pt-3">Closed trades</h3>
            <BtTradesTable trades={data.trades} tz={data.tz} showStrategy
              onView={(id) => setView(snaps.findIndex((t) => t.id === id))} />
          </div>
          {view !== null && view >= 0 && snaps[view] && (
            <Lightbox images={snaps.map((t) => ({ src: bt.snapshotUrl(t.id), name: `${t.strategy} · ${t.direction} ${t.symbol}` }))}
              index={view} onIndex={setView} onClose={() => setView(null)} />
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, cls = "", big }: { label: string; value: React.ReactNode; cls?: string; big?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`${big ? "text-base" : "text-sm"} font-semibold mt-0.5 font-mono ${cls}`}>{value}</div>
    </div>
  );
}

function Group({ title, rows, onPick }: { title: string; rows: GroupRow[]; onPick?: (k: string) => void }) {
  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-2">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-ink-faint">No closed trades.</p> : (
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-faint">
            <tr className="text-left">
              <th className="py-1 pr-2 font-normal"></th>
              <th className="py-1 pr-2 font-normal text-right">Trades</th>
              <th className="py-1 pr-2 font-normal text-right">Win %</th>
              <th className="py-1 pr-2 font-normal text-right">PF</th>
              <th className="py-1 pr-2 font-normal text-right">Net</th>
              <th className="py-1 font-normal text-right">Exp R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`border-t border-card-border ${onPick ? "cursor-pointer hover:bg-card-hover" : ""}`}
                onClick={() => onPick?.(r.key)}>
                <td className="py-1 pr-2">{r.key}</td>
                <td className="py-1 pr-2 text-right font-mono">{r.trades}</td>
                <td className="py-1 pr-2 text-right font-mono">{Math.round(r.win_rate * 100)}%</td>
                <td className="py-1 pr-2 text-right font-mono">{r.profit_factor ?? "∞"}</td>
                <td className={`py-1 pr-2 text-right font-mono ${r.net >= 0 ? "text-pos" : "text-neg"}`}>{money(r.net)}</td>
                <td className="py-1 text-right font-mono">{r.expectancy_r ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
