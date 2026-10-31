import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, PolarAngleAxis, PolarGrid, Radar, RadarChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, TradeSummary } from "../lib/api";
import AnalyticsFilterBar, { AnalyticsFilters } from "../components/AnalyticsFilterBar";
import { formatDuration, formatMoney, formatTimeOnly, pnlColor } from "../lib/format";
import { styleTone } from "../lib/useStyles";
import { Palette, useTheme } from "../lib/theme";
import { useConfig } from "../lib/config";

type Row = { key: string; trades: number; win_rate: number; net_pnl: string; avg_pnl: number; profit_factor: number | null; expectancy_r: number | null };
type Cal = Record<string, { net: number; trades: number; win_rate: number }>;

const EDGE_LABELS: Record<string, string> = {
  win_rate: "Win %", profit_factor: "Profit factor", avg_win_loss: "Avg win/loss",
  recovery_factor: "Recovery", max_drawdown: "Max drawdown", consistency: "Consistency",
};
const EDGE_HELP =
  "Edge score (0-100) blends six parts, each scored 0-100: win % (20%→0, 60%→100), profit factor (0.8→0, 2.5→100), " +
  "avg win/loss (0.5→0, 2.5→100), recovery factor = net P&L ÷ max drawdown (0→0, 3→100), max drawdown as a share of " +
  "gross profit (100%→0, 0%→100) and consistency = share of profit from your best day (80%+→0, 20%→100). " +
  "Weights 15/25/20/10/20/10. Shown once you have 5 closed trades.";

export default function Dashboard() {
  const nav = useNavigate();
  const { c } = useTheme();
  const { tz } = useConfig();
  const [filters, setFilters] = useState<AnalyticsFilters>({ include_demo: true });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cal, setCal] = useState<Cal>({});
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [byStyle, setByStyle] = useState<Row[]>([]);
  const [byPlaybook, setByPlaybook] = useState<Row[]>([]);

  const key = JSON.stringify(filters);
  useEffect(() => {
    setLoading(true);
    const f = filters as any;
    // The comparison tables ignore their own filter, so every row stays visible.
    const { style: _s, ...noStyle } = f;
    const { playbook: _p, ...noPlaybook } = f;
    Promise.all([
      api.dashboard(f).then(setData),
      api.calendar(f).then(setCal),
      api.breakdown("style", noStyle).then(setByStyle),
      api.breakdown("playbook", noPlaybook).then(setByPlaybook),
      api.listTrades({
        account_id: f.account_id, instrument_id: f.instrument_id, style: f.style, playbook: f.playbook,
        include_demo: f.include_demo, date_from: f.date_from, date_to: f.date_to, sort_by: "open_time", order: "desc",
      }).then(setTrades),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, [key]);

  const k = data?.kpis;
  const ccy = filters.currency ?? (k && Object.keys(k.net_by_ccy ?? {})[0]) ?? "USD";
  const money = (v: number | string | null | undefined) => formatMoney(v, ccy);
  const beDays = k ? k.days - k.winning_days - k.losing_days : 0;

  return (
    <div>
      <div className="flex items-end justify-between mb-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {k && <span className="text-xs text-ink-faint">{k.trades} closed trades · {k.days} trading days</span>}
      </div>
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      {loading && !data ? <p className="text-ink-muted text-sm">Loading&hellip;</p> : !k ? null : (
        <>
          {/* Headline tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
            <Tile label="Net P&L" badge={k.trades}>
              <div className="text-2xl font-semibold font-mono">
                {Object.entries(k.net_by_ccy ?? {}).length === 0 ? "—" : Object.entries(k.net_by_ccy).map(([cc, v]) => (
                  <div key={cc} className={pnlColor(v as string)}>{formatMoney(v as string, cc)}</div>
                ))}
              </div>
            </Tile>
            <Tile label="Trade win %">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold font-mono">{Math.round(k.win_rate * 100)}%</span>
                <Gauge parts={[k.wins, k.breakevens, k.losses]} colors={[c.pos, c.accentSoft, c.neg]} track={c.border} />
              </div>
              <Counts items={[[k.wins, "text-pos", "wins"], [k.breakevens, "text-accent-soft", "breakeven"], [k.losses, "text-neg", "losses"]]} />
            </Tile>
            <Tile label="Profit factor">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold font-mono">{k.profit_factor ?? (k.wins ? "∞" : "—")}</span>
                <Donut win={k.avg_win * k.wins} loss={Math.abs(k.avg_loss * k.losses)} pos={c.pos} neg={c.neg} track={c.border} />
              </div>
              <div className="text-[11px] text-ink-faint mt-1.5">gross won ÷ gross lost</div>
            </Tile>
            <Tile label="Day win %">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold font-mono">{Math.round(k.day_win_rate * 100)}%</span>
                <Gauge parts={[k.winning_days, beDays, k.losing_days]} colors={[c.pos, c.accentSoft, c.neg]} track={c.border} />
              </div>
              <Counts items={[[k.winning_days, "text-pos", "green days"], [beDays, "text-accent-soft", "flat days"], [k.losing_days, "text-neg", "red days"]]} />
            </Tile>
            <Tile label="Avg win / loss trade">
              <div className="text-2xl font-semibold font-mono">{k.avg_win_loss_ratio ?? "—"}</div>
              <RatioBar win={k.avg_win} loss={Math.abs(k.avg_loss)} pos={c.pos} neg={c.neg} />
              <div className="flex justify-between text-xs font-mono mt-1"><span className="text-pos">{money(k.avg_win)}</span><span className="text-neg">-{money(Math.abs(k.avg_loss))}</span></div>
            </Tile>
          </div>

          {/* Edge score + cumulative + daily */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] gap-4 mb-4">
            <Card title="Edge score" help={EDGE_HELP}>
              <EdgeRadar edge={data.edge} c={c} />
            </Card>
            <Card title="Daily net cumulative P&L">
              <CumulativeChart points={data.daily_pnl} c={c} money={money} />
            </Card>
            <Card title="Net daily P&L">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.daily_pnl}>
                  <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 9 }} tickFormatter={shortDate} minTickGap={20} />
                  <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={56} tickFormatter={compact} />
                  <Tooltip contentStyle={c.tooltip} formatter={(v: number) => money(v)} labelFormatter={longDate} />
                  <ReferenceLine y={0} stroke={c.faint} />
                  <Bar dataKey="net" radius={[3, 3, 0, 0]}>
                    {data.daily_pnl.map((d: any, i: number) => <Cell key={i} fill={d.net >= 0 ? c.pos : c.neg} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Recent trades + month calendar */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 mb-4">
            <RecentTrades trades={trades} tz={tz} onOpen={(id) => nav(`/trades/${id}`)} />
            <MonthCalendar cal={cal} money={money} onDay={(d) => nav(`/journal?date=${d}`)} />
          </div>

          {/* Drawdown + R distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card title={`Drawdown · max ${money(k.max_drawdown)} (${k.max_drawdown_pct}%)`}>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.equity}>
                  <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 9 }} tickFormatter={shortDate} minTickGap={20} />
                  <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={56} tickFormatter={compact} />
                  <Tooltip contentStyle={c.tooltip} formatter={(v: number) => money(v)} />
                  <Area type="monotone" dataKey="drawdown" stroke={c.neg} fill={c.neg} fillOpacity={0.18} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card title="R-multiple distribution">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.r_distribution}>
                  <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: c.faint, fontSize: 10 }} />
                  <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={28} allowDecimals={false} />
                  <Tooltip contentStyle={c.tooltip} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {data.r_distribution.map((d: any, i: number) => <Cell key={i} fill={d.bucket.startsWith("<") || d.bucket.startsWith("-") ? c.neg : c.pos} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Playbooks + styles */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <GroupTable title="Playbook performance" rows={byPlaybook} money={money} empty="Assign playbooks to trades to compare them."
              badge={(key) => key === "(no playbook)"
                ? <span className="badge bg-card-border text-ink-muted">No playbook</span>
                : <span className="badge bg-accent/15 text-accent-soft">{key}</span>} />
            <GroupTable title="By style" rows={byStyle} money={money} empty="Mark trades as Scalp / Swing… to compare."
              badge={(key) => key === "(unassigned)"
                ? <span className="badge bg-card-border text-ink-muted">Unassigned</span>
                : <span className={`badge ${styleTone(key)}`}>{key}</span>}
              active={filters.style === "__none" ? "(unassigned)" : filters.style}
              onPick={(key) => {
                const v = key === "(unassigned)" ? "__none" : key;
                setFilters({ ...filters, style: filters.style === v ? undefined : v });
              }} />
          </div>

          <YearGrid cal={cal} money={money} />

          {/* Everything else */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mt-4">
            <Mini label="Expectancy" value={money(k.expectancy)} />
            <Mini label="Expectancy R" value={k.expectancy_r ?? "—"} />
            <Mini label="Recovery factor" value={k.recovery_factor ?? "—"} />
            <Mini label="Largest win" value={money(k.largest_win)} cls="text-pos" />
            <Mini label="Largest loss" value={money(k.largest_loss)} cls="text-neg" />
            <Mini label="Streak (W / L)" value={`${k.longest_win_streak} / ${k.longest_loss_streak}`} />
            <Mini label="Hold · winners" value={formatDuration(k.avg_hold_winner ? Math.round(k.avg_hold_winner) : null)} />
            <Mini label="Hold · losers" value={formatDuration(k.avg_hold_loser ? Math.round(k.avg_hold_loser) : null)} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

const shortDate = (d: string) => (d ? d.slice(5).replace("-", "/") : "");
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
const compactMoney = (v: number) => `${v < 0 ? "-" : ""}${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.round(Math.abs(v))}`;

function Tile({ label, badge, children }: { label: string; badge?: number; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-1.5">
        {label}
        {badge !== undefined && <span className="badge bg-card-hover text-ink-faint !px-1.5 !py-0">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-3 flex items-center gap-1.5">
        {title}
        {help && <span className="w-4 h-4 rounded-full border border-card-border text-[10px] text-ink-faint inline-flex items-center justify-center cursor-help" title={help}>i</span>}
      </h3>
      {children}
    </div>
  );
}

function Mini({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={`text-sm font-semibold font-mono mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function Counts({ items }: { items: [number, string, string][] }) {
  return (
    <div className="flex gap-1.5 mt-1.5">
      {items.map(([n, cls, title], i) => <span key={i} title={title} className={`badge bg-card-hover font-mono ${cls}`}>{n}</span>)}
    </div>
  );
}

/** Half-circle gauge split into coloured parts (e.g. wins / breakeven / losses). */
function Gauge({ parts, colors, track }: { parts: number[]; colors: string[]; track: string }) {
  const total = parts.reduce((a, b) => a + b, 0);
  const r = 26, cx = 32, cy = 32, len = Math.PI * r;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  let acc = 0;
  return (
    <svg width="64" height="36" viewBox="0 0 64 36" aria-hidden>
      <path d={arc} fill="none" stroke={track} strokeWidth="6" strokeLinecap="round" />
      {total > 0 && parts.map((p, i) => {
        const seg = (p / total) * len;
        const el = p > 0 ? (
          <path key={i} d={arc} fill="none" stroke={colors[i]} strokeWidth="6" strokeDasharray={`${seg} ${len}`} strokeDashoffset={-acc} />
        ) : null;
        acc += seg;
        return el;
      })}
    </svg>
  );
}

function Donut({ win, loss, pos, neg, track }: { win: number; loss: number; pos: string; neg: string; track: string }) {
  const total = win + loss;
  const r = 15, circ = 2 * Math.PI * r;
  const w = total ? (win / total) * circ : 0;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke={total ? neg : track} strokeWidth="6" />
      {total > 0 && <circle cx="20" cy="20" r={r} fill="none" stroke={pos} strokeWidth="6" strokeDasharray={`${w} ${circ}`} transform="rotate(-90 20 20)" />}
    </svg>
  );
}

function RatioBar({ win, loss, pos, neg }: { win: number; loss: number; pos: string; neg: string }) {
  const t = win + loss;
  const wp = t ? (win / t) * 100 : 50;
  return (
    <div className="flex h-2 rounded-full overflow-hidden mt-2">
      <div style={{ width: `${wp}%`, background: pos }} />
      <div style={{ width: `${100 - wp}%`, background: neg }} />
    </div>
  );
}

function EdgeRadar({ edge, c }: { edge: any; c: Palette }) {
  const rows = Object.entries(EDGE_LABELS).map(([k, label]) => ({ part: label, value: edge?.parts?.[k] ?? 0 }));
  const score = edge?.score as number | null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={190}>
        <RadarChart data={rows} outerRadius="70%">
          <PolarGrid stroke={c.border} />
          <PolarAngleAxis dataKey="part" tick={{ fill: c.muted, fontSize: 10 }} />
          <Radar dataKey="value" stroke={c.accent} fill={c.accent} fillOpacity={0.3} />
          <Tooltip contentStyle={c.tooltip} formatter={(v: number) => `${v} / 100`} />
        </RadarChart>
      </ResponsiveContainer>
      <div className="flex items-end justify-between mt-1">
        <div>
          <div className="text-[11px] text-ink-faint">Your edge score</div>
          <div className="text-2xl font-semibold font-mono">{score ?? "—"}</div>
        </div>
        <div className="flex-1 ml-4 mb-2">
          <div className="relative h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${c.neg}, ${c.warn}, ${c.pos})` }}>
            {score != null && <span className="absolute -top-1 w-1 h-4 rounded bg-ink" style={{ left: `calc(${score}% - 2px)` }} />}
          </div>
          <div className="flex justify-between text-[10px] text-ink-faint mt-1"><span>0</span><span>50</span><span>100</span></div>
        </div>
      </div>
      {!edge?.enough_trades && <p className="text-[11px] text-ink-faint mt-1">Shown once you have 5 closed trades.</p>}
    </div>
  );
}

/** Cumulative P&L by day, green above zero and red below. */
function CumulativeChart({ points, c, money }: { points: { date: string; net: number }[]; c: Palette; money: (v: number) => string }) {
  const data = useMemo(() => {
    let cum = 0;
    return points.map((p) => ({ date: p.date, cum: (cum += p.net) }));
  }, [points]);
  const max = Math.max(0, ...data.map((d) => d.cum));
  const min = Math.min(0, ...data.map((d) => d.cum));
  const split = max - min > 0 ? max / (max - min) : 1;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor={c.pos} stopOpacity={0.35} />
            <stop offset={split} stopColor={c.pos} stopOpacity={0.05} />
            <stop offset={split} stopColor={c.neg} stopOpacity={0.05} />
            <stop offset={1} stopColor={c.neg} stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id="cumLine" x1="0" y1="0" x2="0" y2="1">
            <stop offset={split} stopColor={c.pos} />
            <stop offset={split} stopColor={c.neg} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 9 }} tickFormatter={shortDate} minTickGap={20} />
        <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={56} tickFormatter={compact} />
        <Tooltip contentStyle={c.tooltip} formatter={(v: number) => money(v)} labelFormatter={longDate} />
        <ReferenceLine y={0} stroke={c.faint} />
        <Area type="monotone" dataKey="cum" stroke="url(#cumLine)" fill="url(#cumFill)" strokeWidth={2} baseValue={0} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RecentTrades({ trades, tz, onOpen }: { trades: TradeSummary[]; tz: string; onOpen: (id: number) => void }) {
  const [tab, setTab] = useState<"recent" | "open">("recent");
  const open = trades.filter((t) => t.status === "open");
  const list = (tab === "open" ? open : trades.filter((t) => t.status === "closed")).slice(0, 9);
  return (
    <div className="card p-4">
      <div className="flex gap-4 border-b border-card-border mb-2 text-xs font-medium">
        {([["recent", "Recent trades"], ["open", `Open positions${open.length ? ` (${open.length})` : ""}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`pb-2 -mb-px border-b-2 ${tab === k ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? <p className="text-sm text-ink-faint py-4">{tab === "open" ? "No open positions." : "No closed trades yet."}</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-ink-faint text-left"><th className="font-normal py-1">Date</th><th className="font-normal py-1">Symbol</th><th className="font-normal py-1 text-right">Net P&amp;L</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="border-t border-card-border/60 hover:bg-card-hover cursor-pointer" onClick={() => onOpen(t.id)}>
                <td className="py-1.5 text-ink-muted text-xs">{t.trading_date.slice(5).replace("-", "/")} <span className="text-ink-faint">{t.time_known ? formatTimeOnly(t.open_time, tz) : ""}</span></td>
                <td className="py-1.5">
                  <span className="font-mono font-semibold">{t.symbol}</span>{" "}
                  <span className={`text-xs ${t.direction === "long" ? "text-pos" : "text-neg"}`}>{t.direction === "long" ? "L" : "S"}</span>
                </td>
                <td className={`py-1.5 text-right font-mono ${t.pnl_known ? pnlColor(t.net_pnl) : "text-ink-faint"}`}>
                  {t.status === "open" ? "open" : t.pnl_known ? formatMoney(t.net_pnl, t.currency) : "label"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function isoDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Month heat-map: net P&L and trade count per day, plus a weekly total column. */
function MonthCalendar({ cal, money, onDay }: { cal: Cal; money: (v: number) => string; onDay: (d: string) => void }) {
  const lastDay = Object.keys(cal).sort().pop();
  const monthOf = (iso?: string) => {
    const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  };
  const [month, setMonth] = useState(() => monthOf(lastDay));
  useEffect(() => { if (lastDay) setMonth(monthOf(lastDay)); }, [lastDay]);

  const start = new Date(month);
  start.setDate(1 - start.getDay());
  const weeks: Date[][] = [];
  const cur = new Date(start);
  do {
    const w: Date[] = [];
    for (let i = 0; i < 7; i++) { w.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    weeks.push(w);
  } while (cur.getMonth() === month.getMonth());
  const prefix = isoDay(month).slice(0, 7);
  const monthNet = Object.entries(cal).filter(([d]) => d.startsWith(prefix)).reduce((s, [, v]) => s + v.net, 0);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button className="btn-ghost !px-2 !py-0.5" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <span className="font-medium text-sm w-36 text-center">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button className="btn-ghost !px-2 !py-0.5" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
        <span className="text-xs text-ink-muted">Month: <span className={`font-mono ${pnlColor(monthNet)}`}>{money(monthNet)}</span></span>
      </div>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.1fr)] gap-1 text-[11px]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Week"].map((d) => <div key={d} className="text-center text-ink-faint pb-1">{d}</div>)}
        {weeks.map((w, wi) => {
          const wk = w.map((d) => cal[isoDay(d)]).filter(Boolean);
          const wNet = wk.reduce((s, v) => s + v.net, 0);
          const wTr = wk.reduce((s, v) => s + v.trades, 0);
          return [
            ...w.map((d) => {
              const v = cal[isoDay(d)];
              const inMonth = d.getMonth() === month.getMonth();
              const cls = !v ? "bg-card-hover/60" : v.net > 0 ? "bg-pos/15 border-pos/40" : v.net < 0 ? "bg-neg/15 border-neg/40" : "bg-card-hover";
              return (
                <button key={isoDay(d)} disabled={!v} onClick={() => v && onDay(isoDay(d))} title={v ? `${money(v.net)} · ${v.trades} trades` : ""}
                  className={`h-14 rounded-md border border-transparent p-1 text-left flex flex-col ${cls} ${inMonth ? "" : "opacity-35"} ${v ? "hover:ring-1 hover:ring-accent/50" : ""}`}>
                  <span className="text-ink-faint">{d.getDate()}</span>
                  {v && <span className={`font-mono font-semibold mt-auto ${pnlColor(v.net)}`}>{compactMoney(v.net)}</span>}
                  {v && <span className="text-ink-faint">{v.trades} tr</span>}
                </button>
              );
            }),
            <div key={`w${wi}`} className="h-14 rounded-md bg-card-hover p-1 flex flex-col">
              <span className="text-ink-faint">Week {wi + 1}</span>
              <span className={`font-mono font-semibold mt-auto ${pnlColor(wNet)}`}>{wTr ? compactMoney(wNet) : "—"}</span>
              <span className="text-ink-faint">{wTr ? `${wTr} tr` : ""}</span>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

/** One row per year, one cell per month. */
function YearGrid({ cal, money }: { cal: Cal; money: (v: number) => string }) {
  const years = [...new Set(Object.keys(cal).map((d) => d.slice(0, 4)))].sort().reverse();
  if (years.length === 0) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const agg = (y: string, m: number) => {
    const pre = `${y}-${String(m + 1).padStart(2, "0")}`;
    const days = Object.entries(cal).filter(([d]) => d.startsWith(pre)).map(([, v]) => v);
    return { net: days.reduce((s, v) => s + v.net, 0), trades: days.reduce((s, v) => s + v.trades, 0) };
  };
  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-3">Yearly calendar</h3>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[56px_repeat(12,minmax(64px,1fr))] gap-1 text-[11px] min-w-[860px]">
          <div />
          {months.map((m) => <div key={m} className="text-center text-ink-faint pb-1">{m}</div>)}
          {years.map((y) => [
            <div key={y} className="flex items-center font-medium text-ink-muted">{y}</div>,
            ...months.map((_, i) => {
              const a = agg(y, i);
              const cls = !a.trades ? "bg-card-hover/60" : a.net > 0 ? "bg-pos/20" : a.net < 0 ? "bg-neg/20" : "bg-card-hover";
              return (
                <div key={`${y}${i}`} className={`h-12 rounded-md flex flex-col items-center justify-center ${cls}`} title={a.trades ? money(a.net) : ""}>
                  {a.trades
                    ? <><span className={`font-mono font-semibold ${pnlColor(a.net)}`}>{compactMoney(a.net)}</span><span className="text-ink-faint">{a.trades} trades</span></>
                    : <span className="text-ink-faint">—</span>}
                </div>
              );
            }),
          ])}
        </div>
      </div>
    </div>
  );
}

function GroupTable({ title, rows, money, empty, badge, active, onPick }: {
  title: string; rows: Row[]; money: (v: number | string) => string; empty: string;
  badge: (key: string) => React.ReactNode; active?: string; onPick?: (key: string) => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-medium text-sm">{title}</h3>
        {onPick && rows.length > 0 && <span className="text-[11px] text-ink-faint">Click a row to filter</span>}
      </div>
      {rows.length === 0 ? <p className="text-sm text-ink-faint">{empty}</p> : (
        <table className="w-full text-sm">
          <thead className="text-[11px] text-ink-faint">
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
              <tr key={r.key} onClick={() => onPick?.(r.key)}
                className={`border-t border-card-border ${onPick ? "cursor-pointer hover:bg-card-hover" : ""} ${active === r.key ? "bg-card-hover" : ""}`}>
                <td className="py-1.5 pr-2">{badge(r.key)}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{r.trades}</td>
                <td className="py-1.5 pr-2 text-right font-mono">{Math.round(r.win_rate * 100)}%</td>
                <td className="py-1.5 pr-2 text-right font-mono">{r.profit_factor ?? "∞"}</td>
                <td className={`py-1.5 pr-2 text-right font-mono ${pnlColor(r.net_pnl)}`}>{money(r.net_pnl)}</td>
                <td className="py-1.5 text-right font-mono">{r.expectancy_r ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
