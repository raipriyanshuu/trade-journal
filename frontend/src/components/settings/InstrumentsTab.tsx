import { useEffect, useState } from "react";
import { api, Instrument } from "../../lib/api";
import Modal from "../Modal";

const TZ_OPTIONS = ["America/New_York", "Asia/Kolkata", "America/Chicago", "UTC"];
const QTY_UNITS = ["lots", "units"];

export default function InstrumentsTab() {
  const [rows, setRows] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Instrument | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.listInstruments());
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

  async function verify(inst: Instrument) {
    await api.verifyInstrument(inst.id);
    load();
  }

  const unverified = rows.filter((r) => !r.verified).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-ink-muted">
          Seeded contract specs &amp; lot sizes. {unverified > 0 ? (
            <span className="text-warn">
              {unverified} need verification &mdash; confirm each against your broker.
            </span>
          ) : (
            <span className="text-pos">All verified.</span>
          )}
        </p>
      </div>

      {error && <p className="text-neg text-sm mb-3">{error}</p>}
      {loading ? (
        <p className="text-ink-muted text-sm">Loading&hellip;</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border">
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Exch</th>
                <th className="px-3 py-2 font-medium">Ccy</th>
                <th className="px-3 py-2 font-medium text-right">Point value</th>
                <th className="px-3 py-2 font-medium text-right">Tick</th>
                <th className="px-3 py-2 font-medium text-right">Lot</th>
                <th className="px-3 py-2 font-medium">Qty unit</th>
                <th className="px-3 py-2 font-medium">Session tz</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-card-border/50 hover:bg-card-hover">
                  <td className="px-3 py-2 font-mono font-medium">{r.symbol_root}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.display_name}</td>
                  <td className="px-3 py-2">{r.exchange}</td>
                  <td className="px-3 py-2">{r.currency}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.point_value}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.tick_size}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.lot_size}</td>
                  <td className="px-3 py-2">{r.quantity_unit}</td>
                  <td className="px-3 py-2 text-ink-muted text-xs">{r.session_timezone}</td>
                  <td className="px-3 py-2">
                    {r.verified ? (
                      <span className="badge bg-pos/15 text-pos">verified</span>
                    ) : (
                      <span className="badge bg-warn/15 text-warn">verify</span>
                    )}
                    {!r.active && (
                      <span className="badge bg-card-border text-ink-faint ml-1">inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!r.verified && (
                      <button
                        className="btn-ghost px-2 py-1 text-xs mr-1"
                        onClick={() => verify(r)}
                      >
                        Verify
                      </button>
                    )}
                    <button
                      className="btn-ghost px-2 py-1 text-xs"
                      onClick={() => setEditing(r)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditInstrumentModal
          instrument={editing}
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

function EditInstrumentModal({
  instrument,
  onClose,
  onSaved,
}: {
  instrument: Instrument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...instrument });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof Instrument>(key: K, value: Instrument[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.updateInstrument(instrument.id, {
        display_name: form.display_name,
        exchange: form.exchange,
        currency: form.currency,
        point_value: form.point_value,
        tick_size: form.tick_size,
        lot_size: form.lot_size,
        quantity_unit: form.quantity_unit,
        session_timezone: form.session_timezone,
        active: form.active,
        verified: form.verified,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit ${instrument.symbol_root}`}
      open
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && <p className="text-neg text-sm mb-3">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Display name</label>
          <input
            className="input"
            value={form.display_name}
            onChange={(e) => set("display_name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Exchange</label>
          <input className="input" value={form.exchange} onChange={(e) => set("exchange", e.target.value)} />
        </div>
        <div>
          <label className="label">Currency</label>
          <input className="input" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
        </div>
        <div>
          <label className="label">Point value</label>
          <input className="input font-mono" value={form.point_value} onChange={(e) => set("point_value", e.target.value)} />
        </div>
        <div>
          <label className="label">Tick size</label>
          <input className="input font-mono" value={form.tick_size} onChange={(e) => set("tick_size", e.target.value)} />
        </div>
        <div>
          <label className="label">Lot size</label>
          <input className="input font-mono" value={form.lot_size} onChange={(e) => set("lot_size", e.target.value)} />
        </div>
        <div>
          <label className="label">Quantity unit (imports)</label>
          <select className="input" value={form.quantity_unit} onChange={(e) => set("quantity_unit", e.target.value)}>
            {QTY_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Session time zone</label>
          <select
            className="input"
            value={form.session_timezone}
            onChange={(e) => set("session_timezone", e.target.value)}
          >
            {[...new Set([form.session_timezone, ...TZ_OPTIONS])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.verified} onChange={(e) => set("verified", e.target.checked)} />
          Verified
        </label>
      </div>
    </Modal>
  );
}
