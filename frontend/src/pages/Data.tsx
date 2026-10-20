import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useConfig } from "../lib/config";
import { formatDateTime } from "../lib/format";
import ImportWizard from "../components/import/ImportWizard";
import BarImport from "../components/import/BarImport";

const TABS = [
  { key: "import", label: "Import trades" },
  { key: "history", label: "Import history" },
  { key: "bars", label: "Bar data" },
  { key: "export", label: "Export & backup" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Data() {
  const [tab, setTab] = useState<TabKey>("import");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Import / Export</h1>
      <div className="flex gap-1 mb-6 border-b border-card-border">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "import" && <ImportWizard onImported={() => setRefreshKey((k) => k + 1)} />}
      {tab === "history" && <History key={refreshKey} />}
      {tab === "bars" && <BarImport />}
      {tab === "export" && <ExportTab />}
    </div>
  );
}

function History() {
  const { tz } = useConfig();
  const [batches, setBatches] = useState<Awaited<ReturnType<typeof api.listBatches>>>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.listBatches().then(setBatches).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function undo(id: number) {
    if (!confirm("Undo this whole import batch? Its executions and trades are removed.")) return;
    await api.undoBatch(id);
    load();
  }

  if (loading) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;
  if (batches.length === 0) return <div className="card p-8 text-center text-ink-muted">No imports yet.</div>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-faint border-b border-card-border">
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">File</th>
            <th className="px-3 py-2 font-medium text-right">Read</th>
            <th className="px-3 py-2 font-medium text-right">Imported</th>
            <th className="px-3 py-2 font-medium text-right">Skipped</th>
            <th className="px-3 py-2 font-medium text-right">Failed</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-b border-card-border/50">
              <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{formatDateTime(b.created_at, tz)}</td>
              <td className="px-3 py-2">{b.source}</td>
              <td className="px-3 py-2 text-ink-muted">{b.filename ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono">{b.rows_read}</td>
              <td className="px-3 py-2 text-right font-mono text-pos">{b.rows_imported}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{b.rows_skipped}</td>
              <td className="px-3 py-2 text-right font-mono text-neg">{b.rows_failed}</td>
              <td className="px-3 py-2 text-right">
                <button className="btn-ghost px-2 py-1 text-xs text-neg" onClick={() => undo(b.id)}>Undo</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportTab() {
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  async function onRestore(f: File) {
    if (!confirm("Restore will REPLACE your current database and attachments. Continue?")) return;
    const res = await api.restoreBackup(f);
    setRestoreMsg(res.status === "restored" ? "Restored. Reload the page." : res.message ?? "Restore failed.");
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="card p-5">
        <h3 className="font-medium mb-3">Export</h3>
        <div className="flex flex-col gap-2">
          <a className="btn-ghost justify-start" href="/api/export/trades.csv">Trades &rarr; CSV</a>
          <a className="btn-ghost justify-start" href="/api/export/executions.csv">Executions &rarr; CSV</a>
          <a className="btn-ghost justify-start" href="/api/export/workbook.xlsx">Full Excel workbook (.xlsx)</a>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-medium mb-1">Backup &amp; restore</h3>
        <p className="text-sm text-ink-muted mb-3">A backup is a timestamped zip of the SQLite database plus your attachments.</p>
        <div className="flex items-center gap-3">
          <a className="btn-primary" href="/api/export/backup.zip">Download backup (.zip)</a>
          <label className="btn-ghost cursor-pointer">
            Restore from backup&hellip;
            <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])} />
          </label>
        </div>
        {restoreMsg && <p className="text-sm text-pos mt-2">{restoreMsg}</p>}
      </div>
    </div>
  );
}
