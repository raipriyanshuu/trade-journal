import { useEffect, useState } from "react";
import { api, Account } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import Modal from "../Modal";

const ACCOUNT_TYPES = ["personal", "prop_eval", "prop_funded"];
const CURRENCIES = ["USD", "INR"];
const TYPE_LABEL: Record<string, string> = { personal: "Personal", prop_eval: "Prop evaluation", prop_funded: "Prop funded" };
export const DD_LABEL: Record<string, string> = {
  static: "Static",
  trailing_eod: "Trailing (end of day)",
  trailing_intraday: "Trailing (intraday)",
  trailing_lock_breakeven: "Trailing, locks at breakeven",
};
export const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress", passed: "Passed", failed: "Failed", funded: "Funded", closed: "Closed",
};

const EMPTY: Partial<Account> = {
  name: "",
  platform: "",
  type: "personal",
  currency: "USD",
  starting_balance: "0",
  active: true,
};

export default function AccountsTab() {
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Account> | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.listAccounts());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(acc: Account) {
    if (!confirm(`Delete account "${acc.name}"? This also removes its trades and executions.`))
      return;
    await api.deleteAccount(acc.id);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-ink-muted">Trading accounts. Prop rules feed the Prop Tracker.</p>
        <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
          + Add account
        </button>
      </div>

      {error && <p className="text-neg text-sm mb-3">{error}</p>}
      {loading ? (
        <p className="text-ink-muted text-sm">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-ink-muted">No accounts yet. Add one to start.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Platform</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Ccy</th>
                <th className="px-3 py-2 font-medium text-right">Start balance</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-card-border/50 hover:bg-card-hover">
                  <td className="px-3 py-2 font-medium">
                    {a.name}
                    {a.is_demo && (
                      <span className="badge bg-accent/15 text-accent-soft ml-2">demo</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{a.platform || "—"}</td>
                  <td className="px-3 py-2">{TYPE_LABEL[a.type] ?? a.type}</td>
                  <td className="px-3 py-2">{a.currency}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatMoney(a.starting_balance, a.currency)}
                  </td>
                  <td className="px-3 py-2">
                    {a.active ? (
                      <span className="badge bg-pos/15 text-pos">active</span>
                    ) : (
                      <span className="badge bg-card-border text-ink-faint">inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="btn-ghost px-2 py-1 text-xs mr-1" onClick={() => setEditing(a)}>
                      Edit
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs text-neg" onClick={() => remove(a)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditAccountModal
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

export function EditAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: Partial<Account>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Account>>({ ...account });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isNew = account.id === undefined;
  const isProp = form.type === "prop_eval" || form.type === "prop_funded";

  function set<K extends keyof Account>(key: K, value: Account[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function num(v: string): string | null {
    return v.trim() === "" ? null : v.trim();
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Partial<Account> = {
        name: form.name,
        platform: form.platform || null,
        type: form.type,
        currency: form.currency,
        starting_balance: form.starting_balance || "0",
        active: form.active ?? true,
        account_size: isProp ? num(String(form.account_size ?? "")) : null,
        profit_target: isProp ? num(String(form.profit_target ?? "")) : null,
        daily_loss_limit: isProp ? num(String(form.daily_loss_limit ?? "")) : null,
        max_drawdown_type: isProp ? form.max_drawdown_type || null : null,
        max_drawdown_amount: isProp ? num(String(form.max_drawdown_amount ?? "")) : null,
        max_contracts:
          isProp && form.max_contracts != null && String(form.max_contracts) !== ""
            ? Number(form.max_contracts)
            : null,
        consistency_pct: isProp ? num(String(form.consistency_pct ?? "")) : null,
        min_trading_days:
          isProp && form.min_trading_days != null && String(form.min_trading_days) !== ""
            ? Number(form.min_trading_days)
            : null,
        firm: isProp ? (form.firm ?? "").trim() || null : null,
        prop_status: isProp ? form.prop_status || null : null,
        prop_start_date: isProp ? form.prop_start_date || null : null,
        drawdown_lock_at:
          isProp && form.max_drawdown_type === "trailing_lock_breakeven" ? num(String(form.drawdown_lock_at ?? "")) : null,
      };
      if (isNew) await api.createAccount(payload);
      else await api.updateAccount(account.id!, payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isNew ? "Add account" : `Edit ${account.name}`}
      open
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !form.name}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && <p className="text-neg text-sm mb-3">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Name</label>
          <input className="input" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className="label">Platform / broker</label>
          <input className="input" value={form.platform ?? ""} onChange={(e) => set("platform", e.target.value)} />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.type} onChange={(e) => set("type", e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Starting balance</label>
          <input
            className="input font-mono"
            value={form.starting_balance ?? ""}
            onChange={(e) => set("starting_balance", e.target.value)}
          />
        </div>

        {isProp && (
          <>
            <div className="col-span-2 border-t border-card-border pt-3 mt-1 text-xs text-ink-faint">
              Prop-firm rules. Leave a field empty if your firm doesn't have that rule.
            </div>
            <Field label="Firm" value={form.firm} onChange={(v) => set("firm", v)} placeholder="Apex, Topstep…" text />
            <div>
              <label className="label">Started on</label>
              <input type="date" className="input" value={form.prop_start_date ?? ""}
                onChange={(e) => set("prop_start_date", e.target.value || null)} />
            </div>
            <Field label="Account size" value={form.account_size} onChange={(v) => set("account_size", v)} />
            <Field label="Profit target" value={form.profit_target} onChange={(v) => set("profit_target", v)} />
            <Field label="Daily loss limit" value={form.daily_loss_limit} onChange={(v) => set("daily_loss_limit", v)} />
            <Field label="Max contracts" value={form.max_contracts} onChange={(v) => set("max_contracts", v as unknown as number)} />
            <div>
              <label className="label">Max drawdown type</label>
              <select className="input" value={form.max_drawdown_type ?? ""}
                onChange={(e) => set("max_drawdown_type", e.target.value || null)}>
                <option value="">None</option>
                {Object.entries(DD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <Field label="Max drawdown amount" value={form.max_drawdown_amount} onChange={(v) => set("max_drawdown_amount", v)} />
            {form.max_drawdown_type === "trailing_lock_breakeven" && (
              <div className="col-span-2">
                <Field label="Floor stops rising at (empty = starting balance)" value={form.drawdown_lock_at}
                  onChange={(v) => set("drawdown_lock_at", v)} />
              </div>
            )}
            <Field label="Consistency: best day ≤ % of profit" value={form.consistency_pct} onChange={(v) => set("consistency_pct", v)} />
            <Field label="Minimum trading days" value={form.min_trading_days} onChange={(v) => set("min_trading_days", v as unknown as number)} />
            <div className="col-span-2">
              <label className="label">Status</label>
              <select className="input" value={form.prop_status ?? ""} onChange={(e) => set("prop_status", e.target.value || null)}>
                <option value="">Automatic (from the rules)</option>
                {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <p className="col-span-2 text-[11px] text-ink-faint">
              Starting balance is used if set; otherwise the account size. Trailing drawdown follows closed trades
              (the journal doesn't see open P&amp;L), so the firm's intraday floor can be tighter than shown.
            </p>
          </>
        )}

        <label className="flex items-center gap-2 text-sm col-span-2 mt-1">
          <input type="checkbox" checked={form.active ?? true} onChange={(e) => set("active", e.target.checked)} />
          Active
        </label>
      </div>
    </Modal>
  );
}

function Field({ label, value, onChange, placeholder, text }: {
  label: string; value: string | number | null | undefined; onChange: (v: string) => void; placeholder?: string; text?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className={`input ${text ? "" : "font-mono"}`} value={value ?? ""} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
