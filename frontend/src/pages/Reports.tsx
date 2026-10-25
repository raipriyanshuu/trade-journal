import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { useReference } from "../lib/useReference";
import { useStyles } from "../lib/useStyles";
import { UNASSIGNED_STYLE } from "../lib/api";
import Markdown from "../components/Markdown";

const POS = "#22c58b";
const NEG = "#f0566b";

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shift(anchor: string, period: "week" | "month", dir: number) {
  const d = new Date(`${anchor}T12:00:00`);
  if (period === "week") d.setDate(d.getDate() + 7 * dir);
  else d.setMonth(d.getMonth() + dir);
  return isoDay(d);
}
function pretty(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const COMPARE_ROWS: [string, string, (v: any) => string, boolean][] = [
  ["trades", "Trades", (v) => String(v ?? 0), true],
  ["win_rate", "Win rate", (v) => `${Math.round((v ?? 0) * 100)}%`, true],
  ["net_pnl", "Net P&L", (v) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }), true],
  ["profit_factor", "Profit factor", (v) => (v === null || v === undefined ? "∞" : String(v)), true],
  ["expectancy", "Expectancy", (v) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }), true],
  ["expectancy_r", "Expectancy R", (v) => (v === null || v === undefined ? "—" : `${v}R`), true],
];

export default function Reports() {
  const { accounts } = useReference();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(isoDay(new Date()));
  const [accountId, setAccountId] = useState<number | undefined>();
  const [currency, setCurrency] = useState<string | undefined>();
  const [style, setStyle] = useState<string | undefined>();
  const { styles } = useStyles();
  const [rep, setRep] = useState<any>(null);
  const [ai, setAi] = useState<{ review: string; model: string; truncated: boolean } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  useEffect(() => {
    setAi(null);
    setAiErr(null);
    api.report({ period, anchor, account_id: accountId, currency, style }).then(setRep);
  }, [period, anchor, accountId, currency, style]);

  async function runAi() {
    setAiBusy(true);
    setAiErr(null);
    try {
      setAi(await api.aiReview({ period, anchor, account_id: accountId, currency, style }));
    } catch (e) {
      setAiErr((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="report-page">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4 no-print">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex p-1 bg-bg-soft rounded-lg">
            {(["week", "month"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1 rounded-md text-xs font-medium ${period === p ? "bg-card text-ink" : "text-ink-muted"}`}>
                {p === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
          <button className="btn-ghost !px-2" onClick={() => setAnchor(shift(anchor, period, -1))}>&larr;</button>
          <input type="date" className="input !w-auto" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          <button className="btn-ghost !px-2" onClick={() => setAnchor(shift(anchor, period, 1))}>&rarr;</button>
          <select className="input !w-auto" value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_demo ? " (demo)" : ""}</option>)}
          </select>
          <select className="input !w-auto" value={currency ?? ""} onChange={(e) => setCurrency(e.target.value || undefined)}>
            <option value="">All ccy</option><option value="USD">USD</option><option value="INR">INR</option>
          </select>
          <select className="input !w-auto" value={style ?? ""} onChange={(e) => setStyle(e.target.value || undefined)}>
            <option value="">All styles</option>
            {styles.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value={UNASSIGNED_STYLE}>Unassigned</option>
          </select>
          <button className="btn-ghost" onClick={() => window.print()}>Export PDF</button>
        </div>
      </div>

      {!rep ? <p className="text-ink-muted text-sm">Loading&hellip;</p> : (
        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-faint">{period === "week" ? "Weekly" : "Monthly"} review</div>
            <h2 className="text-xl font-semibold">
              {pretty(rep.start)} &ndash; {pretty(rep.end)}
              {style && <span className="text-ink-muted font-normal"> &middot; {style === UNASSIGNED_STYLE ? "unassigned" : style} trades</span>}
            </h2>
            <p className="text-xs text-ink-faint">Compared with {pretty(rep.previous.start)} &ndash; {pretty(rep.previous.end)}{!currency && " · money figures mix currencies unless you pick one"}</p>
          </div>

          {rep.focus && (
            <div className="card p-4 border-accent/40 bg-accent/10">
              <div className="text-xs uppercase tracking-wider text-accent-soft">Suggested focus</div>
              <div className="text-lg font-semibold mt-1">{rep.focus.title}</div>
              <p className="text-sm text-ink-muted mt-1">{rep.focus.detail}</p>
              {rep.focus_candidates.length > 1 && (
                <details className="mt-2 text-sm">
                  <summary className="text-ink-faint cursor-pointer">Other things worth working on ({rep.focus_candidates.length - 1})</summary>
                  <ul className="mt-2 space-y-1">
                    {rep.focus_candidates.slice(1).map((f: any) => <li key={f.rule}><span className="text-ink">{f.title}</span> <span className="text-ink-faint">&mdash; {f.detail}</span></li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-4 lg:col-span-1">
              <h3 className="font-medium text-sm mb-2">This period vs last</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-ink-faint text-left"><th className="py-1 font-medium"></th><th className="py-1 pl-3 font-medium text-right">Now</th><th className="py-1 pl-3 font-medium text-right">Prev</th><th className="py-1 pl-3 font-medium text-right">&Delta;</th></tr></thead>
                <tbody>
                  {COMPARE_ROWS.map(([key, label, fmt]) => {
                    const c = rep.compare[key];
                    const d = c.delta;
                    return (
                      <tr key={key} className="border-t border-card-border/40">
                        <td className="py-1.5 text-ink-muted">{label}</td>
                        <td className="py-1.5 text-right font-mono">{fmt(c.current)}</td>
                        <td className="py-1.5 text-right font-mono text-ink-faint">{fmt(c.previous)}</td>
                        <td className={`py-1.5 text-right font-mono ${d === null || d === 0 ? "text-ink-faint" : d > 0 ? "text-pos" : "text-neg"}`}>
                          {d === null || d === 0 ? "—" : `${d > 0 ? "▲" : "▼"}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card p-4 lg:col-span-2">
              <h3 className="font-medium text-sm mb-2">Daily P&amp;L</h3>
              {rep.daily_pnl.length === 0 ? <p className="text-ink-faint text-sm">No closed trades.</p> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={rep.daily_pnl}>
                    <CartesianGrid stroke="#232b3b" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: "#6b7688", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#6b7688", fontSize: 10 }} width={52} />
                    <Tooltip contentStyle={{ background: "#141a27", border: "1px solid #232b3b", fontSize: 12 }} />
                    <Bar dataKey="net" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {rep.daily_pnl.map((d: any, i: number) => <Cell key={i} fill={d.net >= 0 ? POS : NEG} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ListCard title="Best setups" empty="No tagged setups yet." rows={rep.best_setups.map((s: any) => [s.key, s.net_pnl, `${s.trades} trades · ${Math.round(s.win_rate * 100)}%`])} />
            <ListCard title="Worst setups" empty="No losing setups." rows={rep.worst_setups.map((s: any) => [s.key, s.net_pnl, `${s.trades} trades · ${Math.round(s.win_rate * 100)}%`])} />
            <ListCard title="Costliest mistakes" empty="No costly mistakes." rows={rep.top_mistakes.map((m: any) => [m.type.replace(/^(tag|manual):/, ""), m.net_pnl, `${m.count}×`])} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Mini label="Clean streak" value={`${rep.clean_streak.days_since_last} days`} sub={`best ${rep.clean_streak.best}`} />
            <Mini label="Rule violations" value={String(rep.rule_violations)} cls={rep.rule_violations ? "text-neg" : "text-pos"} />
            <Mini label="Mistake rate" value={`${Math.round(rep.mistake_rate * 100)}%`} />
            <Mini label="Missed setups" value={String(rep.missed.count)} sub={rep.missed.potential_r ? `~${rep.missed.potential_r}R` : undefined} />
            <Mini label="Planned days" value={`${rep.discipline.days_with_plan} / ${rep.discipline.trading_days}`} />
            <Mini label="Reviewed days" value={`${rep.discipline.days_reviewed} / ${rep.discipline.trading_days}`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="font-medium text-sm mb-2">Discipline</h3>
              <div className="text-sm space-y-1 text-ink-muted">
                <div>Followed plan: {Object.entries(rep.discipline.followed_plan).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</div>
                <div>Day grades: {Object.entries(rep.discipline.day_grades).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</div>
                <div>Avg mood {rep.discipline.avg_mood ?? "—"} &middot; avg sleep {rep.discipline.avg_sleep ?? "—"}</div>
                <div>Violations: {Object.entries(rep.violations_by_rule).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}</div>
              </div>
            </div>
            <div className="card p-4">
              <h3 className="font-medium text-sm mb-2">Lessons you wrote</h3>
              {rep.discipline.lessons.length === 0 ? <p className="text-ink-faint text-sm">None this period.</p> : (
                <ul className="text-sm space-y-1">
                  {rep.discipline.lessons.map((l: any) => <li key={l.date}><span className="text-ink-faint font-mono text-xs mr-2">{l.date}</span>{l.lesson}</li>)}
                </ul>
              )}
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">AI review <span className="badge bg-card-border text-ink-faint ml-1">optional &middot; paid per use</span></h3>
              <button className="btn-ghost text-xs no-print" onClick={runAi} disabled={aiBusy}>{aiBusy ? "Writing review…" : ai ? "Regenerate" : "Generate AI review"}</button>
            </div>
            {aiErr && <p className="text-sm text-warn">{aiErr}</p>}
            {!ai && !aiErr && (
              <p className="text-xs text-ink-faint">Sends only an anonymized statistics summary (no account names, notes or lessons) to the Claude API using your key. Off until you enable it in Settings &rarr; AI review.</p>
            )}
            {ai && (
              <>
                <Markdown text={ai.review} />
                <p className="text-[11px] text-ink-faint mt-2">Generated by {ai.model}{ai.truncated ? " (truncated)" : ""}. A performance review, not investment advice.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ListCard({ title, rows, empty }: { title: string; rows: [string, string, string][]; empty: string }) {
  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-2">{title}</h3>
      {rows.length === 0 ? <p className="text-ink-faint text-sm">{empty}</p> : (
        <ul className="space-y-1.5">
          {rows.map(([name, net, sub]) => (
            <li key={name} className="flex items-center justify-between text-sm">
              <span>{name} <span className="text-xs text-ink-faint">{sub}</span></span>
              <span className={`font-mono ${Number(net) >= 0 ? "text-pos" : "text-neg"}`}>{net}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function Mini({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={`font-mono font-semibold ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-faint">{sub}</div>}
    </div>
  );
}
