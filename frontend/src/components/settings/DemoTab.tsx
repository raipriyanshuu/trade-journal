import { useEffect, useState } from "react";
import { api, DemoStatus } from "../../lib/api";

export default function DemoTab() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setStatus(await api.demoStatus());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function load() {
    setBusy(true);
    try {
      await api.loadDemo();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Remove all demo data? Anything you logged yourself is kept.")) return;
    setBusy(true);
    try {
      const res = await api.clearDemo();
      const kept = (res.kept_accounts as string[] | undefined) ?? [];
      setErr(kept.length
        ? `Kept ${kept.join(", ")} as a normal account because it holds trades or journal days you logged.`
        : null);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="card p-5">
        <h3 className="font-medium mb-1">Demo data</h3>
        <p className="text-sm text-ink-muted mb-4">
          Load clearly-marked sample data to explore the UI. Demo rows carry a{" "}
          <span className="badge bg-accent/15 text-accent-soft">demo</span> flag and are fully
          removable &mdash; they never mix with your real trades.
        </p>

        {err && <p className="text-warn text-sm mb-3">{err}</p>}

        <div className="flex items-center gap-4 mb-4 text-sm">
          <span className="text-ink-muted">Status:</span>
          {status ? (
            status.present ? (
              <span className="badge bg-pos/15 text-pos">
                loaded &middot; {status.accounts} accounts &middot; {status.executions} executions
                &middot; {status.trades} trades
              </span>
            ) : (
              <span className="badge bg-card-border text-ink-faint">not loaded</span>
            )
          ) : (
            <span className="text-ink-faint">&hellip;</span>
          )}
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" onClick={load} disabled={busy || status?.present}>
            Load demo data
          </button>
          <button className="btn-danger" onClick={clear} disabled={busy || !status?.present}>
            Clear demo data
          </button>
        </div>
      </div>
    </div>
  );
}
