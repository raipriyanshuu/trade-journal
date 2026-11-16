import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Account, api, PropAccountStatus, LedgerTotals } from "../lib/api";
import { formatMoney, pnlColor } from "../lib/format";
import { DD_LABEL, EditAccountModal } from "../components/settings/AccountsTab";
import { LEVEL_BORDER, LEVEL_TEXT, lossLevel, RuleRow, StatusBadge } from "../components/prop/PropBits";

type Totals = LedgerTotals & { by_status: Record<string, number>; trading_profit: number };

const NEW_PROP: Partial<Account> = {
  name: "", platform: "", type: "prop_eval", currency: "USD", starting_balance: "", active: true,
  max_drawdown_type: "trailing_eod",
};

export default function PropTracker() {
  const [rows, setRows] = useState<PropAccountStatus[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const [showEnded, setShowEnded] = useState(true);
  const nav = useNavigate();

  async function load() {
    try {
      const r = await api.propAccounts();
      setRows(r.accounts);
      setTotals(r.totals);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => { load(); }, []);

  async function duplicate(a: Account) {
    const copy = await api.duplicateAccount(a.id);
    nav(`/prop/${copy.id}`);
  }

  const ended = (r: PropAccountStatus) => ["failed", "closed"].includes(r.status.status) || !r.account.active;
  const visible = (rows ?? []).filter((r) => showEnded || !ended(r));
  const ccy = rows?.[0]?.account.currency ?? "USD";

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Prop Tracker</h1>
          <p className="text-sm text-ink-muted">Every prop account against its rules, from your closed trades.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
            Show failed &amp; closed
          </label>
          <button className="btn-primary" onClick={() => setEditing({ ...NEW_PROP })}>+ Prop account</button>
        </div>
      </div>

      {err && <p className="text-neg text-sm mb-3">{err}</p>}

      {totals && rows && rows.length > 0 && (
        <div className="card p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label="Accounts">
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(totals.by_status).map(([s, n]) => (
                <span key={s} className="flex items-center gap-1 text-xs"><StatusBadge status={s} /> {n}</span>
              ))}
            </div>
          </Stat>
          <Stat label="Spent (fees, resets)"><span className="text-neg">{formatMoney(-totals.costs, ccy)}</span></Stat>
          <Stat label="Payouts received"><span className="text-pos">{formatMoney(totals.payouts, ccy)}</span></Stat>
          <Stat label="Net from prop firms"><span className={pnlColor(totals.net)}>{formatMoney(totals.net, ccy)}</span></Stat>
          <Stat label="Trading P&L in prop accounts"><span className={pnlColor(totals.trading_profit)}>{formatMoney(totals.trading_profit, ccy)}</span></Stat>
        </div>
      )}

      {rows === null ? (
        <p className="text-ink-muted text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-muted mb-1">No prop accounts yet.</p>
          <p className="text-xs text-ink-faint mb-4">
            Add one with the firm's rules (or change an existing account's type to prop evaluation / funded in Settings).
          </p>
          <button className="btn-primary" onClick={() => setEditing({ ...NEW_PROP })}>+ Prop account</button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => (
            <PropCard key={r.account.id} r={r} onEdit={() => setEditing(r.account)} onDuplicate={() => duplicate(r.account)} />
          ))}
        </div>
      )}

      {editing && (
        <EditAccountModal account={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-lg font-semibold font-mono">{children}</div>
    </div>
  );
}

function PropCard({ r, onEdit, onDuplicate }: { r: PropAccountStatus; onEdit: () => void; onDuplicate: () => void }) {
  const { account: a, status: s } = r;
  const m = (v: number | null) => formatMoney(v, a.currency);
  const dead = s.status === "failed" || s.status === "closed";
  const canLoseLevel = lossLevel(s.rules);
  return (
    <div className={`card p-4 border ${dead ? "border-card-border opacity-70" : LEVEL_BORDER[s.worst_level]}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <Link to={`/prop/${a.id}`} className="font-semibold hover:text-accent-soft truncate block">{a.name}</Link>
          <div className="text-xs text-ink-faint truncate">
            {[a.firm, a.type === "prop_funded" ? "Funded" : "Evaluation", s.drawdown_type && DD_LABEL[s.drawdown_type]]
              .filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={s.status} />
          {a.prop_status && a.prop_status !== s.suggested_status && (
            <span className="text-[10px] text-ink-faint">rules say: {s.suggested_status.replace("_", " ")}</span>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[11px] text-ink-faint">Balance</div>
          <div className="text-2xl font-semibold font-mono">{m(s.balance)}</div>
          <div className={`text-xs font-mono ${pnlColor(s.profit)}`}>{s.profit >= 0 ? "+" : ""}{m(s.profit)}</div>
        </div>
        {!dead && s.can_lose_today != null && (
          <div className="text-right">
            <div className="text-[11px] text-ink-faint">Can lose today</div>
            <div className={`text-xl font-semibold font-mono ${LEVEL_TEXT[canLoseLevel]}`}>{m(s.can_lose_today)}</div>
            {s.floor != null && <div className="text-[11px] text-ink-faint font-mono">floor {m(s.floor)}</div>}
          </div>
        )}
      </div>

      {s.rules.length > 0 ? (
        <div className="space-y-2.5">
          {s.rules.map((rule) => <RuleRow key={rule.key} r={rule} ccy={a.currency} />)}
        </div>
      ) : (
        <p className="text-xs text-ink-faint">No rules set. Edit the account to add the firm's rules.</p>
      )}

      {s.breaches.length > 0 && (
        <p className="text-xs text-neg mt-3">
          {s.breaches.length} rule break{s.breaches.length > 1 ? "s" : ""} · last on {s.breaches[s.breaches.length - 1].date}
        </p>
      )}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-card-border text-xs">
        <span className="text-ink-faint">
          {s.trading_days} day{s.trading_days === 1 ? "" : "s"} · {s.trades} trade{s.trades === 1 ? "" : "s"}
          {r.ledger_totals.costs > 0 && <> · spent {m(r.ledger_totals.costs)}</>}
        </span>
        <span className="flex gap-1">
          <button className="btn-ghost px-2 py-1" onClick={onEdit}>Edit rules</button>
          <button className="btn-ghost px-2 py-1" onClick={onDuplicate} title="Same rules, fresh account">Duplicate</button>
          <Link to={`/prop/${a.id}`} className="btn-ghost px-2 py-1">Open →</Link>
        </span>
      </div>
    </div>
  );
}
