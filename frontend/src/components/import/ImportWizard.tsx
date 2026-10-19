import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useReference } from "../../lib/useReference";

const FILL_FIELDS: [string, string][] = [
  ["timestamp", "Time *"],
  ["symbol", "Symbol *"],
  ["side", "Side *"],
  ["quantity", "Quantity *"],
  ["price", "Price *"],
  ["fees", "Fees"],
  ["external_id", "External ID"],
];

const ROUNDTRIP_FIELDS: [string, string][] = [
  ["symbol", "Symbol *"],
  ["direction", "Direction *"],
  ["entry_time", "Entry time"],
  ["entry_price", "Entry price"],
  ["exit_time", "Exit time"],
  ["exit_price", "Exit price"],
  ["quantity", "Quantity"],
  ["fees", "Fees"],
  ["pnl", "P&L"],
  ["external_id", "External ID"],
];

const TZ = ["America/New_York", "Asia/Kolkata", "America/Chicago", "Europe/London", "UTC"];

export default function ImportWizard({ onImported }: { onImported: () => void }) {
  const { accounts, instruments } = useReference();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [source, setSource] = useState<"import" | "notion">("import");
  const [accountId, setAccountId] = useState<number | "">("");
  const [format, setFormat] = useState<"fills" | "roundtrip">("fills");
  const [map, setMap] = useState<Record<string, string>>({});
  const [dtFormat, setDtFormat] = useState("auto");
  const [fileTz, setFileTz] = useState("America/New_York");
  const [qtyUnit, setQtyUnit] = useState("instrument");
  const [tagColumns, setTagColumns] = useState<string[]>([]);
  const [symbolMapText, setSymbolMapText] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profiles, setProfiles] = useState<{ id: number; name: string; format: string; config: Record<string, unknown> }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.runImport>> | null>(null);

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch(() => {});
  }, []);

  async function onFile(f: File) {
    setFile(f);
    setResult(null);
    setErr(null);
    try {
      const prev = await api.previewImport(f);
      setHeaders(prev.headers);
      setRows(prev.rows);
      // Best-effort auto-map on matching header names.
      const auto: Record<string, string> = {};
      const fields = format === "fills" ? FILL_FIELDS : ROUNDTRIP_FIELDS;
      for (const [field] of fields) {
        const hit = prev.headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, "").includes(field.replace(/_/g, "")));
        if (hit) auto[field] = hit;
      }
      setMap(auto);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function buildConfig() {
    const symbol_map: Record<string, string> = {};
    symbolMapText.split("\n").forEach((line) => {
      const [raw, root] = line.split(/[=,:]/).map((s) => s.trim());
      if (raw && root) symbol_map[raw] = root;
    });
    return {
      source,
      account_id: Number(accountId),
      format,
      column_map: map,
      datetime_format: dtFormat,
      file_timezone: fileTz,
      quantity_unit: qtyUnit,
      symbol_map,
      tag_columns: tagColumns,
    };
  }

  async function run() {
    if (!file || !accountId) {
      setErr("Pick a file and an account.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.runImport(file, buildConfig());
      setResult(res);
      onImported();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!profileName) return;
    await api.saveProfile(profileName, format, {
      column_map: map, datetime_format: dtFormat, file_timezone: fileTz,
      quantity_unit: qtyUnit, tag_columns: tagColumns, source,
    });
    api.listProfiles().then(setProfiles);
  }

  function loadProfile(id: number) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const c = p.config as Record<string, unknown>;
    setFormat(p.format as "fills" | "roundtrip");
    setMap((c.column_map as Record<string, string>) ?? {});
    setDtFormat((c.datetime_format as string) ?? "auto");
    setFileTz((c.file_timezone as string) ?? "UTC");
    setQtyUnit((c.quantity_unit as string) ?? "instrument");
    setTagColumns((c.tag_columns as string[]) ?? []);
    setSource(((c.source as string) as "import" | "notion") ?? "import");
  }

  const fields = format === "fills" ? FILL_FIELDS : ROUNDTRIP_FIELDS;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Source</label>
            <select className="input !w-auto" value={source} onChange={(e) => setSource(e.target.value as "import" | "notion")}>
              <option value="import">Broker CSV</option>
              <option value="notion">Notion export</option>
            </select>
          </div>
          <div>
            <label className="label">File</label>
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
          </div>
          {profiles.length > 0 && (
            <div>
              <label className="label">Load profile</label>
              <select className="input !w-auto" onChange={(e) => e.target.value && loadProfile(Number(e.target.value))} defaultValue="">
                <option value="">&mdash;</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {headers.length > 0 && (
        <>
          <div className="card p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Account</label>
                <select className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                  <option value="">Select&hellip;</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Format</label>
                <select className="input" value={format} onChange={(e) => setFormat(e.target.value as "fills" | "roundtrip")}>
                  <option value="fills">Fills (one row per execution)</option>
                  <option value="roundtrip">Round-trip (one row per trade)</option>
                </select>
              </div>
              <div>
                <label className="label">File time zone</label>
                <select className="input" value={fileTz} onChange={(e) => setFileTz(e.target.value)}>
                  {[...new Set([fileTz, ...TZ])].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Quantity unit</label>
                <select className="input" value={qtyUnit} onChange={(e) => setQtyUnit(e.target.value)}>
                  <option value="instrument">Per instrument default</option>
                  <option value="lots">Lots</option>
                  <option value="units">Units</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Column mapping</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {fields.map(([field, lbl]) => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted w-24">{lbl}</span>
                    <select className="input" value={map[field] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}>
                      <option value="">&mdash;</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Date/time format (or "auto")</label>
                <input className="input font-mono" value={dtFormat} onChange={(e) => setDtFormat(e.target.value)} placeholder="%Y-%m-%d %H:%M:%S" />
              </div>
              {source === "notion" && (
                <div>
                  <label className="label">Tag columns (multi-select)</label>
                  <select multiple className="input h-[72px]" value={tagColumns}
                    onChange={(e) => setTagColumns(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="label">Symbol map (one per line: RAW = ROOT). Optional &mdash; most are auto-detected.</label>
              <textarea className="input font-mono text-xs min-h-[56px]" value={symbolMapText}
                onChange={(e) => setSymbolMapText(e.target.value)} placeholder={"ESZ6 = ES\nNIFTY26OCTFUT = NIFTY"} />
            </div>

            <div className="flex items-center gap-2">
              <button className="btn-primary" onClick={run} disabled={busy}>{busy ? "Importing…" : "Run import"}</button>
              <input className="input !w-48" placeholder="Save mapping as…" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
              <button className="btn-ghost" onClick={saveProfile} disabled={!profileName}>Save profile</button>
            </div>
            {err && <p className="text-neg text-sm">{err}</p>}
          </div>

          {/* Preview */}
          <div className="card overflow-x-auto">
            <div className="px-3 py-2 text-xs text-ink-faint border-b border-card-border">Preview (first {rows.length} rows)</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-faint border-b border-card-border">
                  {headers.map((h) => <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-b border-card-border/40">
                    {headers.map((h) => <td key={h} className="px-2 py-1 font-mono whitespace-nowrap">{r[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {result && (
        <div className="card p-4">
          <h3 className="font-medium mb-2">Import complete</h3>
          <div className="flex gap-4 text-sm">
            <span className="text-ink-muted">Read: {result.rows_read}</span>
            <span className="text-pos">Imported: {result.imported}</span>
            <span className="text-ink-muted">Skipped (dupes): {result.skipped}</span>
            <span className="text-neg">Failed: {result.failed}</span>
          </div>
          {result.errors.length > 0 && (
            <ul className="text-xs text-neg mt-2 list-disc ml-5 max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
