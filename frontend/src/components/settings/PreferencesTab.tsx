import { useEffect, useState } from "react";
import { api, Settings } from "../../lib/api";

const TZ_OPTIONS = ["Asia/Kolkata", "America/New_York", "America/Chicago", "Europe/London", "UTC"];

export default function PreferencesTab() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const tz = (settings.display_timezone as string) ?? "Asia/Kolkata";
  const rate = (settings.usd_inr_rate as string) ?? "";
  const be = (settings.breakeven_threshold as Record<string, string>) ?? { USD: "1", INR: "50" };

  function setKey(key: string, value: unknown) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const updated = await api.updateSettings({
        display_timezone: tz,
        usd_inr_rate: rate,
        breakeven_threshold: be,
      });
      setSettings(updated);
      setMsg("Saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;

  return (
    <div className="max-w-xl space-y-5">
      {err && <p className="text-neg text-sm">{err}</p>}

      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Display time zone</label>
          <select className="input" value={tz} onChange={(e) => setKey("display_timezone", e.target.value)}>
            {[...new Set([tz, ...TZ_OPTIONS])].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-faint mt-1">
            All timestamps are stored in UTC and shown in this zone (default Asia/Kolkata).
          </p>
        </div>

        <div>
          <label className="label">USD / INR rate (for the combined view)</label>
          <input
            className="input font-mono"
            value={rate}
            onChange={(e) => setKey("usd_inr_rate", e.target.value)}
            placeholder="e.g. 88.0"
          />
          <p className="text-xs text-ink-faint mt-1">
            USD and INR are never summed silently. The combined view uses this rate and is always
            labelled "converted".
          </p>
        </div>

        <div>
          <label className="label">Breakeven threshold (|net P&amp;L| below this = breakeven)</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-ink-faint">USD</span>
              <input
                className="input font-mono"
                value={be.USD ?? ""}
                onChange={(e) => setKey("breakeven_threshold", { ...be, USD: e.target.value })}
              />
            </div>
            <div>
              <span className="text-xs text-ink-faint">INR</span>
              <input
                className="input font-mono"
                value={be.INR ?? ""}
                onChange={(e) => setKey("breakeven_threshold", { ...be, INR: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </button>
        {msg && <span className="text-pos text-sm">{msg}</span>}
      </div>
    </div>
  );
}
