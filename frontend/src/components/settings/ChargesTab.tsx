import { useEffect, useState } from "react";
import { api } from "../../lib/api";

const FIELDS: [string, string][] = [
  ["brokerage_per_order", "Brokerage per order (₹, max)"],
  ["brokerage_pct", "Brokerage % (if lower)"],
  ["stt_sell_pct", "STT / CTT % (sell side)"],
  ["exchange_pct", "Exchange txn %"],
  ["sebi_per_crore", "SEBI fee (₹ per crore)"],
  ["stamp_buy_pct", "Stamp duty % (buy side)"],
  ["gst_pct", "GST % (on brokerage + exchange + SEBI)"],
];

export default function ChargesTab() {
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setCfg((s.india_charges as Record<string, any>) ?? {}));
  }, []);

  if (!cfg) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;

  function setField(ex: string, key: string, value: string) {
    setCfg((c) => ({ ...c!, [ex]: { ...(c![ex] ?? {}), [key]: value } }));
  }

  async function save() {
    await api.updateSettings({ india_charges: cfg });
    setMsg("Saved.");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-ink-muted">
        Used by the <span className="text-ink">auto</span> button next to Fees when logging NSE / MCX trades.
        Contract value = price &times; point value &times; lots. Rates change &mdash; compare one contract note before trusting them.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {["NSE", "MCX"].map((ex) => (
          <div key={ex} className="card p-4 space-y-2">
            <h3 className="font-medium">{ex}</h3>
            {FIELDS.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-muted">{label}</span>
                <input className="input !w-28 font-mono !py-1" value={cfg[ex]?.[key] ?? ""} onChange={(e) => setField(ex, key, e.target.value)} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!cfg.verified} onChange={(e) => setCfg({ ...cfg, verified: e.target.checked })} />
          I&rsquo;ve verified these rates against my broker
        </label>
        {!cfg.verified && <span className="badge bg-warn/15 text-warn">verify</span>}
        <button className="btn-primary ml-auto" onClick={save}>Save charges</button>
        {msg && <span className="text-pos text-sm">{msg}</span>}
      </div>
    </div>
  );
}
