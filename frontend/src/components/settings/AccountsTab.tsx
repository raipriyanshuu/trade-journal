import { useEffect, useState } from "react";
import { api, Account } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import Modal from "../Modal";

const ACCOUNT_TYPES = ["personal", "prop_eval", "prop_funded"];
const CURRENCIES = ["USD", "INR"];
const DD_TYPES = ["", "static", "trailing_intraday", "trailing_eod", "trailing_lock_breakeven"];

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
        <p className="text-sm text-ink-muted">Trading accounts. Prop-rule fields feed Phase 6.</p>
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
                  <td className="px-3 py-2">{a.type}</td>
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

function EditAccountModal({
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
                {t}
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
              Prop rules (used in Phase 6)
            </div>
            <div>
              <label className="label">Account size</label>
              <input className="input font-mono" value={form.account_size ?? ""} onChange={(e) => set("account_size", e.target.value)} />
            </div>
            <div>
              <label className="label">Profit target</label>
              <input className="input font-mono" value={form.profit_target ?? ""} onChange={(e) => set("profit_target", e.target.value)} />
            </div>
            <div>
              <label className="label">Daily loss limit</label>
              <input className="input font-mono" value={form.daily_loss_limit ?? ""} onChange={(e) => set("daily_loss_limit", e.target.value)} />
            </div>
            <div>
              <label className="label">Max contracts</label>
              <input className="input font-mono" value={form.max_contracts ?? ""} onChange={(e) => set("max_contracts", e.target.value as unknown as number)} />
            </div>
            <div>
              <label className="label">Max drawdown type</label>
              <select
                className="input"
                value={form.max_drawdown_type ?? ""}
                onChange={(e) => set("max_drawdown_type", e.target.value)}
              >
                {DD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t || "—"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Max drawdown amount</label>
              <input className="input font-mono" value={form.max_drawdown_amount ?? ""} onChange={(e) => set("max_drawdown_amount", e.target.value)} />
            </div>
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
