import { useEffect, useState } from "react";
import { useTheme } from "../lib/theme";
import { useNavigate } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, TradeSummary } from "../lib/api";
import AnalyticsFilterBar, { AnalyticsFilters } from "../components/AnalyticsFilterBar";


export default function Mistakes() {
  const { c } = useTheme();
  const NEG = c.neg, POS = c.pos, ACCENT = c.accent, GRID = c.border;
  const nav = useNavigate();
  const [filters, setFilters] = useState<AnalyticsFilters>({ include_demo: true });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<{ type: string; trades: TradeSummary[] } | null>(null);

  function load() {
    setLoading(true);
    api.mistakesAnalytics(filters as any).then(setData).finally(() => setLoading(false));
  }
  useEffect(load, [JSON.stringify(filters)]);

  async function recompute() {
    await api.recomputeMistakes();
    load();
  }

  async function openDrill(type: string) {
    const trades = await api.mistakeDrilldown(type, filters as any);
    setDrill({ type, trades });
  }

  if (loading || !data) return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Mistakes</h1>
      <p className="text-ink-muted text-sm">Loading&hellip;</p>
    </div>
  );

  const cvm = data.clean_vs_mistake;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Mistakes</h1>
        <button className="btn-ghost" onClick={recompute}>Recompute</button>
      </div>
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      {/* Top strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Clean streak" value={`${data.clean_streak.days_since_last} days`} sub={`best ${data.clean_streak.best}`} />
        <Stat label="Mistake trades" value={`${data.mistake_trades}`} sub={`of ${data.total_trades}`} />
        <Stat label="Mistake rate" value={data.total_trades ? `${Math.round((data.mistake_trades / data.total_trades) * 100)}%` : "—"} />
        <Stat label="Mistake types" value={`${data.cost_by_type.length}`} />
      </div>

      {/* Cost of mistakes */}
      <Section title="Cost of mistakes (ranked)">
        {data.cost_by_type.length === 0 ? (
          <p className="text-ink-muted text-sm">No mistakes in this range. Clean trading.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border">
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Count</th>
                <th className="px-3 py-2 font-medium text-right">Net P&amp;L</th>
                <th className="px-3 py-2 font-medium text-right">Avg</th>
                <th className="px-3 py-2 font-medium text-right">Total R</th>
              </tr>
            </thead>
            <tbody>
              {data.cost_by_type.map((r: any) => (
                <tr key={r.type} className="border-b border-card-border/40 hover:bg-card-hover cursor-pointer" onClick={() => openDrill(r.type)}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{labelType(r.type)}</span>
                    <div className="text-xs text-ink-faint">{r.explanation}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.count}</td>
                  <td className={`px-3 py-2 text-right font-mono ${Number(r.net_pnl) < 0 ? "text-neg" : "text-pos"}`}>{r.net_pnl}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">{r.avg_net}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">{r.total_r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Clean vs mistake */}
        <Section title="Clean vs mistake trades">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border">
                <th className="px-2 py-1.5 font-medium">Metric</th>
                <th className="px-2 py-1.5 font-medium text-right text-pos">Clean</th>
                <th className="px-2 py-1.5 font-medium text-right text-neg">Mistake</th>
              </tr>
            </thead>
            <tbody>
              <CmpRow k="Trades" clean={cvm.clean.trades} mistake={cvm.mistake.trades} />
              <CmpRow k="Win rate" clean={pct(cvm.clean.win_rate)} mistake={pct(cvm.mistake.win_rate)} />
              <CmpRow k="Profit factor" clean={cvm.clean.profit_factor ?? "∞"} mistake={cvm.mistake.profit_factor ?? "∞"} />
              <CmpRow k="Expectancy ($)" clean={cvm.clean.expectancy} mistake={cvm.mistake.expectancy} />
              <CmpRow k="Expectancy (R)" clean={cvm.clean.expectancy_r ?? "—"} mistake={cvm.mistake.expectancy_r ?? "—"} />
              <CmpRow k="Net P&L" clean={cvm.clean.net_pnl} mistake={cvm.mistake.net_pnl} />
            </tbody>
          </table>
        </Section>

        {/* Equity overlay */}
        <Section title="Equity: actual vs without mistakes">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.equity_overlay}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 10 }} hide />
              <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={48} />
              <Tooltip contentStyle={c.tooltip} />
              <Line type="monotone" dataKey="actual" stroke={ACCENT} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="without_mistakes" stroke={POS} dot={false} strokeWidth={2} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs mt-1">
            <span className="text-accent-soft">● actual</span>
            <span className="text-pos">● without mistakes</span>
          </div>
        </Section>
      </div>

      {/* When mistakes happen */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <RateChart title="By weekday" rows={data.when.by_weekday} />
        <RateChart title="By time in session" rows={data.when.by_session_bucket} />
        <RateChart title="By trade # in day" rows={data.when.by_trade_number} />
      </div>

      {/* After-loss behaviour */}
      <Section title="After-loss behaviour" className="mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-faint border-b border-card-border">
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium text-right">Trades</th>
              <th className="px-3 py-2 font-medium text-right">Win rate</th>
              <th className="px-3 py-2 font-medium text-right">Avg P&amp;L</th>
              <th className="px-3 py-2 font-medium text-right">Mistake rate</th>
            </tr>
          </thead>
          <tbody>
            {[["Overall", data.after_loss_behavior.overall], ["After 1 loss", data.after_loss_behavior.after_one_loss],
              ["After 2 losses", data.after_loss_behavior.after_two_losses], ["After a big win", data.after_loss_behavior.after_big_win]].map(([lbl, b]: any) => (
              <tr key={lbl} className="border-b border-card-border/40">
                <td className="px-3 py-2">{lbl}</td>
                <td className="px-3 py-2 text-right font-mono">{b.count}</td>
                <td className="px-3 py-2 text-right font-mono">{pct(b.win_rate)}</td>
                <td className={`px-3 py-2 text-right font-mono ${Number(b.avg_pnl) < 0 ? "text-neg" : "text-pos"}`}>{b.avg_pnl}</td>
                <td className="px-3 py-2 text-right font-mono text-ink-muted">{pct(b.mistake_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Trends */}
      {data.trends.length > 0 && (
        <Section title="Weekly mistake trend" className="mt-4">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.trends}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fill: c.faint, fontSize: 10 }} />
              <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={40} />
              <Tooltip contentStyle={c.tooltip} />
              <Bar dataKey="count" fill={NEG} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {drill && (
        <DrillModal drill={drill} onClose={() => setDrill(null)} onOpen={(id) => nav(`/trades/${id}`)} />
      )}
    </div>
  );
}

function labelType(t: string): string {
  if (t.startsWith("tag:")) return t.slice(4) + " (tag)";
  if (t.startsWith("manual:")) return t.slice(7) + " (manual)";
  return t;
}
function pct(v: number) { return `${Math.round((v ?? 0) * 100)}%`; }

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}
function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      <h3 className="font-medium text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}
function CmpRow({ k, clean, mistake }: { k: string; clean: React.ReactNode; mistake: React.ReactNode }) {
  return (
    <tr className="border-b border-card-border/40">
      <td className="px-2 py-1.5 text-ink-muted">{k}</td>
      <td className="px-2 py-1.5 text-right font-mono">{clean}</td>
      <td className="px-2 py-1.5 text-right font-mono">{mistake}</td>
    </tr>
  );
}
function RateChart({ title, rows }: { title: string; rows: any[] }) {
  const { c } = useTheme();
  const GRID = c.border, NEG = c.neg;
  const data = rows.map((r) => ({ bucket: r.bucket, rate: Math.round(r.rate * 100), trades: r.trades }));
  return (
    <Section title={title}>
      {data.length === 0 ? <p className="text-ink-faint text-sm">No data.</p> : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fill: c.faint, fontSize: 10 }} />
            <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={32} unit="%" />
            <Tooltip contentStyle={c.tooltip} />
            <Bar dataKey="rate" fill={NEG} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Section>
  );
}
function DrillModal({ drill, onClose, onOpen }: { drill: { type: string; trades: TradeSummary[] }; onClose: () => void; onOpen: (id: number) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-card-border">
          <h3 className="font-semibold">{labelType(drill.type)} &middot; {drill.trades.length} trades</h3>
          <button className="text-ink-faint hover:text-ink text-lg" onClick={onClose}>&times;</button>
        </div>
        <div className="overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {drill.trades.map((t) => (
                <tr key={t.id} className="border-b border-card-border/40 hover:bg-card-hover cursor-pointer" onClick={() => onOpen(t.id)}>
                  <td className="px-3 py-2">{t.trading_date}</td>
                  <td className="px-3 py-2 font-mono">{t.symbol}</td>
                  <td className={`px-3 py-2 ${t.direction === "long" ? "text-pos" : "text-neg"}`}>{t.direction}</td>
                  <td className={`px-3 py-2 text-right font-mono ${Number(t.net_pnl) < 0 ? "text-neg" : "text-pos"}`}>{t.net_pnl} {t.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
