import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useReference } from "../../lib/useReference";

const FIELDS: [string, string, RegExp][] = [
  ["timestamp", "Time *", /^(date ?time|time ?stamp|time|date|datetime)$/i],
  ["open", "Open *", /^o(pen)?$/i],
  ["high", "High *", /^h(igh)?$/i],
  ["low", "Low *", /^l(ow)?$/i],
  ["close", "Close *", /^c(lose)?$/i],
  ["volume", "Volume", /^v(ol(ume)?)?$/i],
];
const TZ = ["America/New_York", "America/Chicago", "Asia/Kolkata", "Europe/London", "UTC"];

export default function BarImport() {
  const { instruments } = useReference();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [instrumentId, setInstrumentId] = useState<number | "">("");
  const [timeframe, setTimeframe] = useState("1m");
  const [tz, setTz] = useState("America/New_York");
  const [dtFormat, setDtFormat] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof api.barCoverage>>>([]);

  const loadCoverage = () => api.barCoverage().then(setCoverage);
  useEffect(() => { loadCoverage(); }, []);

  async function onFile(f: File) {
    setFile(f);
    setMsg(null);
    setErr(null);
    const prev = await api.previewImport(f);
    setHeaders(prev.headers);
    const auto: Record<string, string> = {};
    for (const [field, , re] of FIELDS) {
      const hit = prev.headers.find((h) => re.test(h.trim()));
      if (hit) auto[field] = hit;
    }
    setMap(auto);
  }

  async function run() {
    if (!file || !instrumentId) {
      setErr("Pick a file and an instrument.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.importBars(file, {
        instrument_id: Number(instrumentId), timeframe, column_map: map, datetime_format: dtFormat, file_timezone: tz,
      });
      setMsg(`Imported ${r.imported} bars · ${r.skipped} already present · ${r.failed} failed`);
      loadCoverage();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(instId: number, tf: string) {
    if (!confirm(`Delete all ${tf} bars for this instrument?`)) return;
    await api.deleteBars(instId, tf);
    loadCoverage();
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="card p-4 space-y-4">
        <p className="text-sm text-ink-muted">
          Export 1-minute or 5-minute OHLCV from your charting platform as CSV. Bars power the trade replay chart and MAE/MFE analysis.
          Re-importing the same file is safe &mdash; existing bars are skipped.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">CSV file</label>
            <input type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>
          <div>
            <label className="label">Instrument</label>
            <select className="input" value={instrumentId} onChange={(e) => setInstrumentId(Number(e.target.value))}>
              <option value="">Select&hellip;</option>
              {instruments.map((i) => <option key={i.id} value={i.id}>{i.symbol_root}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Timeframe</label>
            <select className="input" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="1m">1 minute</option>
              <option value="5m">5 minutes</option>
            </select>
          </div>
          <div>
            <label className="label">File time zone</label>
            <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
              {TZ.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {headers.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {FIELDS.map(([field, label]) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted w-16">{label}</span>
                  <select className="input" value={map[field] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}>
                    <option value="">&mdash;</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="label">Date/time format (or "auto")</label>
                <input className="input !w-56 font-mono" value={dtFormat} onChange={(e) => setDtFormat(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={run} disabled={busy}>{busy ? "Importing…" : "Import bars"}</button>
            </div>
          </>
        )}
        {msg && <p className="text-sm text-pos">{msg}</p>}
        {err && <p className="text-sm text-neg">{err}</p>}
      </div>

      <div className="card overflow-x-auto">
        <div className="px-3 py-2 text-sm font-medium border-b border-card-border">Bar coverage</div>
        {coverage.length === 0 ? <p className="p-4 text-sm text-ink-faint">No bars imported yet.</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint border-b border-card-border">
                {["Instrument", "Timeframe", "Bars", "From (UTC)", "To (UTC)", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {coverage.map((c) => (
                <tr key={`${c.instrument_id}-${c.timeframe}`} className="border-b border-card-border/40">
                  <td className="px-3 py-2 font-mono">{c.symbol}</td>
                  <td className="px-3 py-2">{c.timeframe}</td>
                  <td className="px-3 py-2 font-mono">{c.bars.toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.first?.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.last?.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-2 text-right"><button className="btn-ghost !py-0.5 text-xs text-neg" onClick={() => remove(c.instrument_id, c.timeframe)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
