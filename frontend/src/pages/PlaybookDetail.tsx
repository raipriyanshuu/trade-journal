import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, BriefStats, PlaybookDetail as PD } from "../lib/api";
import { formatMoney, pnlColor } from "../lib/format";
import { useTheme } from "../lib/theme";
import PlaybookEditor from "../components/playbooks/PlaybookEditor";
import { sectionsOf, tone } from "../components/playbooks/shared";
import { ResultBadge } from "../components/journal/Pickers";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

function NetLines({ byCcy }: { byCcy: Record<string, string> }) {
  const e = Object.entries(byCcy);
  if (!e.length) return <>—</>;
  return <>{e.map(([c, v]) => <span key={c} className={`block ${pnlColor(v)}`}>{formatMoney(v, c)}</span>)}</>;
}

export default function PlaybookDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { c } = useTheme();
  const [pb, setPb] = useState<PD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = () => api.getPlaybook(Number(id)).then(setPb).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [id]);

  if (err) return <p className="text-neg text-sm">{err}</p>;
  if (!pb) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;
  const s = pb.stats;

  async function remove() {
    const n = s.trades + s.missed;
    if (!confirm(`Delete "${pb!.name}" and its rules?${n ? ` Its ${n} trade(s) stay in your journal, just without a playbook.` : ""}`)) return;
    await api.deletePlaybook(pb!.id);
    nav("/playbooks");
  }
  async function duplicate() {
    const copy = await api.duplicatePlaybook(pb!.id);
    nav(`/playbooks/${copy.id}`);
  }
  async function archive() {
    await api.updatePlaybook(pb!.id, { archived: !pb!.archived });
    load();
  }

  return (
    <div>
      <button className="text-ink-muted hover:text-ink text-sm mb-3" onClick={() => nav("/playbooks")}>&larr; All playbooks</button>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg font-semibold ${tone(pb.color).chip}`}>
            {pb.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{pb.name} {pb.archived && <span className="badge bg-card-border text-ink-faint align-middle">archived</span>}</h1>
            {pb.description && <p className="text-sm text-ink-muted max-w-2xl">{pb.description}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setEditing(true)}>Edit rules</button>
          <button className="btn-ghost" onClick={duplicate}>Duplicate</button>
          <button className="btn-ghost" onClick={archive}>{pb.archived ? "Unarchive" : "Archive"}</button>
          <button className="btn-ghost text-neg" onClick={remove}>Delete</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
        <Kpi label="Net P&L"><NetLines byCcy={s.net_by_ccy} /></Kpi>
        <Kpi label="Trades">{s.trades}{s.open ? <span className="text-xs text-ink-faint"> ({s.open} open)</span> : null}</Kpi>
        <Kpi label="Win rate">{pct(s.win_rate)}</Kpi>
        <Kpi label="Profit factor">{s.profit_factor ?? (s.wins ? "∞" : "—")}</Kpi>
        <Kpi label="Expectancy">{s.expectancy_r != null ? `${s.expectancy_r}R` : "—"}</Kpi>
        <Kpi label="Avg win / loss"><span className="text-pos">{s.avg_win.toFixed(0)}</span> / <span className="text-neg">{s.avg_loss.toFixed(0)}</span></Kpi>
        <Kpi label="Missed trades">{s.missed}</Kpi>
        <Kpi label="Rules followed">{pct(s.adherence)}</Kpi>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-4 lg:col-span-2">
          <h3 className="font-medium text-sm mb-3">Cumulative P&amp;L</h3>
          {s.equity.length < 2 ? <p className="text-sm text-ink-faint">Needs at least two closed trades.</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={s.equity}>
                <defs>
                  <linearGradient id="pbeq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.pos} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.pos} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 10 }} />
                <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={56} />
                <Tooltip contentStyle={c.tooltip} />
                <Area type="monotone" dataKey="cumulative" stroke={c.pos} fill="url(#pbeq)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card p-4">
          <h3 className="font-medium text-sm mb-1">Following the rules pays?</h3>
          <p className="text-xs text-ink-faint mb-3">Trades where every rule was ticked vs at least one missed.</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-faint"><tr><th className="text-left font-normal pb-1"></th><th className="text-right font-normal pb-1">All rules</th><th className="text-right font-normal pb-1">Broke a rule</th></tr></thead>
            <tbody>
              <Cmp label="Trades" a={s.followed_all.trades} b={s.broke_rules.trades} />
              <Cmp label="Win rate" a={pct(s.followed_all.win_rate)} b={pct(s.broke_rules.win_rate)} />
              <Cmp label="Profit factor" a={pf(s.followed_all)} b={pf(s.broke_rules)} />
              <Cmp label="Expectancy" a={er(s.followed_all)} b={er(s.broke_rules)} />
              <tr className="border-t border-card-border">
                <td className="py-1.5 text-ink-muted">Net</td>
                <td className="py-1.5 text-right font-mono"><NetLines byCcy={s.followed_all.net_by_ccy} /></td>
                <td className="py-1.5 text-right font-mono"><NetLines byCcy={s.broke_rules.net_by_ccy} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">Rules</h3>
            <button className="text-xs text-accent-soft hover:underline" onClick={() => setEditing(true)}>Edit</button>
          </div>
          {pb.rules.length === 0 ? <p className="text-sm text-ink-faint">No rules yet. Click Edit to add them.</p> : (
            <div className="space-y-3">
              {sectionsOf(pb.rules).map((sec) => (
                <div key={sec}>
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">{sec}</div>
                  <ul className="space-y-1">
                    {pb.rules.filter((r) => r.section === sec).map((r) => (
                      <li key={r.id} className="text-sm flex items-start gap-2"><span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ink-faint shrink-0" />{r.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card p-4">
          <h3 className="font-medium text-sm mb-2">Rule by rule</h3>
          {s.per_rule.length === 0 || s.trades === 0 ? <p className="text-sm text-ink-faint">Tick rules on your trades to see which ones matter.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-faint">
                <tr className="text-left"><th className="font-normal pb-1">Rule</th><th className="font-normal pb-1 text-right">Followed</th><th className="font-normal pb-1 text-right" title="Win rate when followed / when not">Win % yes / no</th></tr>
              </thead>
              <tbody>
                {s.per_rule.map((r) => (
                  <tr key={r.rule_id} className="border-t border-card-border">
                    <td className="py-1.5 pr-2">{r.text}</td>
                    <td className="py-1.5 text-right font-mono whitespace-nowrap">{pct(r.follow_rate)}</td>
                    <td className="py-1.5 text-right font-mono whitespace-nowrap">
                      <span className="text-pos">{pct(r.win_rate_followed)}</span> / <span className="text-neg">{pct(r.win_rate_not_followed)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="font-medium text-sm px-4 pt-3 pb-2">Trades in this playbook</h3>
        {pb.trades.length === 0 ? <p className="text-sm text-ink-faint px-4 pb-4">No trades yet. Pick this playbook when you log a trade, or on any trade's page.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-faint border-b border-card-border text-xs">
                <th className="px-4 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Symbol</th><th className="px-2 py-1.5 font-medium">Dir</th>
                <th className="px-2 py-1.5 font-medium">Result</th><th className="px-2 py-1.5 font-medium text-right">Rules</th>
                <th className="px-2 py-1.5 font-medium text-right">R</th><th className="px-4 py-1.5 font-medium text-right">Net</th>
              </tr></thead>
              <tbody>
                {pb.trades.map((t) => (
                  <tr key={t.id} className="border-b border-card-border/40 hover:bg-card-hover cursor-pointer" onClick={() => nav(`/trades/${t.id}`)}>
                    <td className="px-4 py-1.5 text-ink-muted">{t.trading_date}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{t.symbol}</td>
                    <td className={`px-2 py-1.5 ${t.direction === "long" ? "text-pos" : "text-neg"}`}>{t.direction === "long" ? "Long" : "Short"}</td>
                    <td className="px-2 py-1.5"><ResultBadge result={t.result} partial={t.partial_profit} /></td>
                    <td className={`px-2 py-1.5 text-right font-mono ${t.rules_total && t.rules_followed === t.rules_total ? "text-pos" : "text-ink-muted"}`}>
                      {t.rules_total ? `${t.rules_followed}/${t.rules_total}` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{t.r_multiple ? `${t.r_multiple}R` : "—"}</td>
                    <td className={`px-4 py-1.5 text-right font-mono ${t.status === "missed" ? "text-ink-faint" : pnlColor(t.net_pnl)}`}>
                      {t.status === "missed" ? "missed" : formatMoney(t.net_pnl, t.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <PlaybookEditor playbook={pb} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

const pf = (b: BriefStats) => (b.trades ? b.profit_factor ?? "∞" : "—");
const er = (b: BriefStats) => (b.expectancy_r != null ? `${b.expectancy_r}R` : "—");

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-sm font-semibold font-mono mt-0.5">{children}</div>
    </div>
  );
}

function Cmp({ label, a, b }: { label: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <tr className="border-t border-card-border">
      <td className="py-1.5 text-ink-muted">{label}</td>
      <td className="py-1.5 text-right font-mono">{a}</td>
      <td className="py-1.5 text-right font-mono">{b}</td>
    </tr>
  );
}
