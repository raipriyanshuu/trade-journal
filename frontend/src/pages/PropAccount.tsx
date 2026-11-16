import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, PropAccountStatus } from "../lib/api";
import { formatMoney, pnlColor } from "../lib/format";
import { useTheme } from "../lib/theme";
import { DD_LABEL, EditAccountModal } from "../components/settings/AccountsTab";
import { LEVEL_TEXT, lossLevel, RuleRow, StatusBadge } from "../components/prop/PropBits";

const KIND_LABEL: Record<string, string> = {
  eval_fee: "Evaluation fee",
  activation_fee: "Activation fee",
  reset: "Reset (restarts the balance)",
  subscription: "Subscription",
  other_cost: "Other cost",
  payout: "Payout received",
};

const today = () => new Date().toLocaleDateString("en-CA");

export default function PropAccount() {
  const { id } = useParams();
  const nav = useNavigate();
  const { c } = useTheme();
  const [d, setD] = useState<PropAccountStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState({ entry_date: today(), kind: "eval_fee", amount: "", note: "" });
  const [ledgerErr, setLedgerErr] = useState<string | null>(null);

  async function load() {
    try {
      setD(await api.propAccount(Number(id)));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => { load(); }, [id]);

  if (err) return <div><BackLink /><p className="text-neg text-sm mt-3">{err}</p></div>;
  if (!d) return <p className="text-ink-muted text-sm">Loading…</p>;

  const { account: a, status: s } = d;
  const m = (v: number | null | undefined) => formatMoney(v ?? null, a.currency);
  const history = s.history ?? [];
  const breachByDate = new Map<string, string[]>();
  for (const b of s.breaches) breachByDate.set(b.date, [...(breachByDate.get(b.date) ?? []), b.detail]);
  const chart = history.length ? [{ date: "start", balance: s.start_balance, floor: history[0].floor != null ? s.start_balance - (Number(a.max_drawdown_amount) || 0) : null, target: history[0].target }, ...history] : [];

  async function addEntry() {
    setLedgerErr(null);
    try {
      await api.addLedger(a.id, entry);
      setEntry({ ...entry, amount: "", note: "" });
      load();
    } catch (e) {
      setLedgerErr((e as Error).message);
    }
  }

  async function removeEntry(entryId: number) {
    if (!confirm("Remove this entry?")) return;
    await api.deleteLedger(entryId);
    load();
  }

  async function duplicate() {
    const copy = await api.duplicateAccount(a.id);
    nav(`/prop/${copy.id}`);
  }

  return (
    <div>
      <BackLink />
      <div className="flex items-start justify-between gap-3 flex-wrap mt-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{a.name}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="text-sm text-ink-muted">
            {[a.firm, a.type === "prop_funded" ? "Funded" : "Evaluation", s.drawdown_type && DD_LABEL[s.drawdown_type],
              s.period_start && `counting from ${s.period_start}`].filter(Boolean).join(" · ")}
          </p>
          {a.prop_status && a.prop_status !== s.suggested_status && (
            <p className="text-xs text-ink-faint">You set the status by hand; by the rules it would be "{s.suggested_status.replace("_", " ")}".</p>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setEditing(true)}>Edit rules</button>
          <button className="btn-ghost" onClick={duplicate} title="Same rules, fresh account">Duplicate</button>
          <Link className="btn-ghost" to={`/trades?account=${a.id}`}>Trades</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Balance" value={m(s.balance)} sub={<span className={pnlColor(s.profit)}>{s.profit >= 0 ? "+" : ""}{m(s.profit)} profit</span>} />
        <Kpi label="To target" value={s.target ? m(s.target_remaining) : "—"}
          sub={s.target ? `${Math.max(0, s.target_pct ?? 0).toFixed(0)}% of ${m(s.target)}` : "no target set"} />
        <Kpi label="Drawdown floor" value={s.floor != null ? m(s.floor) : "—"}
          sub={s.distance_to_floor != null ? `${m(s.distance_to_floor)} above it` : "no drawdown rule"} />
        <Kpi label={`Can lose today (${s.today})`} value={s.can_lose_today != null ? m(s.can_lose_today) : "—"}
          tone={LEVEL_TEXT[lossLevel(s.rules)]}
          sub={s.daily_left != null ? `daily ${m(s.daily_left)} left · today ${m(s.today_net)}` : `today ${m(s.today_net)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-2">Balance vs floor vs target</h3>
          {chart.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chart}>
                <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fill: c.faint, fontSize: 10 }} width={64} domain={["auto", "auto"]}
                  tickFormatter={(v) => Number(v).toLocaleString()} />
                <Tooltip contentStyle={c.tooltip} formatter={(v: number, name: string) => [m(v), name]} />
                <Line type="monotone" dataKey="balance" name="Balance" stroke={c.accent} strokeWidth={2} dot={{ r: 2 }} />
                <Line type="stepAfter" dataKey="floor" name="Floor" stroke={c.neg} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="target" name="Target" stroke={c.pos} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-ink-faint py-16 text-center">No closed trades in this account yet.</p>
          )}
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">Rules</h3>
          {s.rules.length ? (
            <div className="space-y-3">{s.rules.map((r) => <RuleRow key={r.key} r={r} ccy={a.currency} />)}</div>
          ) : (
            <p className="text-xs text-ink-faint">No rules set yet.</p>
          )}
          <p className="text-[11px] text-ink-faint mt-4">
            From closed trades only. The firm also counts open P&amp;L, so on trailing intraday accounts its floor can be higher.
          </p>
        </div>
      </div>

      {s.breaches.length > 0 && (
        <div className="card p-4 mb-4 border border-neg/50">
          <h3 className="text-sm font-semibold text-neg mb-2">Rule breaks</h3>
          <ul className="text-sm space-y-1">
            {s.breaches.map((b, i) => (
              <li key={i}><span className="font-mono text-ink-faint mr-2">{b.date}</span>{b.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 overflow-x-auto">
          <h3 className="text-sm font-semibold px-4 pt-4 pb-2">Day by day</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border text-xs">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium text-right">Trades</th>
                <th className="px-3 py-2 font-medium text-right">Day P&amp;L</th>
                <th className="px-3 py-2 font-medium text-right">Lowest</th>
                <th className="px-3 py-2 font-medium text-right">Close balance</th>
                <th className="px-3 py-2 font-medium text-right">Floor</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => {
                const broke = breachByDate.get(h.date);
                return (
                  <tr key={h.date} className={`border-b border-card-border/50 ${broke ? "bg-neg/5" : ""}`}>
                    <td className="px-3 py-1.5 font-mono">
                      <Link className="hover:text-accent-soft" to={`/journal?date=${h.date}&account=${a.id}`}>{h.date}</Link>
                    </td>
                    <td className="px-3 py-1.5 text-right">{h.trades || "—"}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${pnlColor(h.day_net)}`}>{h.trades ? m(h.day_net) : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-muted">{h.trades ? m(h.low) : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{m(h.balance)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-muted">{m(h.floor)}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {h.payout != null && <span className="text-pos mr-2">payout {m(h.payout)}</span>}
                      {broke && <span className="text-neg">{broke.join("; ")}</span>}
                    </td>
                  </tr>
                );
              })}
              {history.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-faint">Nothing yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-1">Costs &amp; payouts</h3>
          <div className="grid grid-cols-3 gap-2 text-xs mb-3">
            <div><div className="text-ink-faint">Spent</div><div className="font-mono text-neg">{m(d.ledger_totals.costs)}</div></div>
            <div><div className="text-ink-faint">Paid out</div><div className="font-mono text-pos">{m(d.ledger_totals.payouts)}</div></div>
            <div><div className="text-ink-faint">Net</div><div className={`font-mono ${pnlColor(d.ledger_totals.net)}`}>{m(d.ledger_totals.net)}</div></div>
          </div>
          <div className="space-y-2 mb-3">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input" value={entry.entry_date}
                onChange={(e) => setEntry({ ...entry, entry_date: e.target.value })} aria-label="Date" />
              <input className="input font-mono" placeholder="Amount" value={entry.amount}
                onChange={(e) => setEntry({ ...entry, amount: e.target.value })} aria-label="Amount" />
            </div>
            <select className="input" value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })} aria-label="Kind">
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Note (optional)" value={entry.note}
                onChange={(e) => setEntry({ ...entry, note: e.target.value })} aria-label="Note"
                onKeyDown={(e) => e.key === "Enter" && entry.amount && addEntry()} />
              <button className="btn-primary" disabled={!entry.amount.trim()} onClick={addEntry}>Add</button>
            </div>
            {entry.kind === "reset" && (
              <p className="text-[11px] text-warn">A reset restarts the balance: trades before this date stop counting.</p>
            )}
            {ledgerErr && <p className="text-neg text-xs">{ledgerErr}</p>}
          </div>
          <ul className="divide-y divide-card-border/60 text-sm">
            {[...(d.ledger ?? [])].reverse().map((e) => (
              <li key={e.id} className="py-1.5 flex items-center gap-2">
                <span className="font-mono text-xs text-ink-faint w-20 shrink-0">{e.entry_date}</span>
                <span className="flex-1 min-w-0 truncate" title={e.note}>
                  {KIND_LABEL[e.kind]?.replace(" (restarts the balance)", "") ?? e.kind}
                  {e.note && <span className="text-ink-faint"> · {e.note}</span>}
                </span>
                <span className={`font-mono ${e.kind === "payout" ? "text-pos" : "text-neg"}`}>
                  {e.kind === "payout" ? "+" : "−"}{m(e.amount)}
                </span>
                <button className="text-ink-faint hover:text-neg text-xs" onClick={() => removeEntry(e.id)} aria-label="Remove entry">✕</button>
              </li>
            ))}
            {(d.ledger ?? []).length === 0 && <li className="py-2 text-xs text-ink-faint">No fees or payouts logged.</li>}
          </ul>
        </div>
      </div>

      {editing && (
        <EditAccountModal account={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
    </div>
  );
}

function BackLink() {
  return <Link to="/prop" className="text-xs text-ink-faint hover:text-ink">← Prop Tracker</Link>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`text-xl font-semibold font-mono ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}
