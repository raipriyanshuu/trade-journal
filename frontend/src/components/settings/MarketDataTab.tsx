import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface MdCfg { enabled: boolean; auto_fetch_on_save: boolean; symbols: Record<string, string> }

export default function MarketDataTab() {
  const [cfg, setCfg] = useState<MdCfg | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setCfg((s.market_data as MdCfg) ?? { enabled: false, auto_fetch_on_save: true, symbols: {} }));
  }, []);

  if (!cfg) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;

  async function save(next: MdCfg = cfg!) {
    const saved = await api.updateSettings({ market_data: next });
    setCfg(saved.market_data as MdCfg);
    setMsg("Saved.");
  }

  async function backfill() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.marketDataBackfill();
      setMsg(`Checked ${r.trades} trades: ${r.fetched} charts fetched, ${r.cached} already stored, ${r.failed} failed.${r.errors.length ? " " + r.errors[0] : ""}`);
    } catch (e) {
      setMsg((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-4 text-sm text-ink-muted space-y-2">
        <p><span className="text-ink font-medium">Delayed charts for CME futures</span> (ES, NQ, Gold, Crude and their micros) from Yahoo Finance, free and slightly delayed &mdash; fine for journaling after the trade.</p>
        <ul className="list-disc ml-5 space-y-1">
          <li>1-minute bars for trades in the last ~30 days, 5-minute up to ~60 days. Older trades need a CSV import.</li>
          <li>Yahoo shows the <span className="text-ink">continuous front-month</span> contract: prices can be slightly off your fills around roll dates. Micros use the full-size chart.</li>
          <li>Only the ticker and a time window are sent &mdash; never your trades. Bars are stored locally, so each chart is fetched once.</li>
          <li>Yahoo&rsquo;s chart service is unofficial and can rate-limit; CSV import always works.</li>
        </ul>
      </div>

      <div className="card p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ ...cfg, enabled: e.target.checked })} />
          Enable delayed charts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.auto_fetch_on_save} disabled={!cfg.enabled}
            onChange={(e) => save({ ...cfg, auto_fetch_on_save: e.target.checked })} />
          Fetch automatically when I save a trade or missed setup
        </label>
        <div className="flex items-center gap-3 pt-1">
          <button className="btn-ghost" onClick={backfill} disabled={!cfg.enabled || busy}>
            {busy ? "Fetching…" : "Fetch charts for my recent trades"}
          </button>
          {msg && <span className="text-sm text-ink-muted">{msg}</span>}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-medium text-sm mb-2">Symbol mapping</h3>
        <p className="text-xs text-ink-faint mb-3">Instrument &rarr; Yahoo ticker. Clear a ticker to stop fetching for that instrument.</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(cfg.symbols).map(([root, sym]) => (
            <div key={root} className="flex items-center gap-2">
              <span className="font-mono text-sm w-14">{root}</span>
              <input className="input font-mono !py-1" value={sym}
                onChange={(e) => setCfg({ ...cfg, symbols: { ...cfg.symbols, [root]: e.target.value } })} />
            </div>
          ))}
        </div>
        <button className="btn-primary mt-3" onClick={() => save()}>Save mapping</button>
      </div>
    </div>
  );
}
