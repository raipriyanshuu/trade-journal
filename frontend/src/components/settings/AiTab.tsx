import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface AiCfg { enabled: boolean; api_key: string; api_key_set?: boolean; model: string }

export default function AiTab() {
  const [cfg, setCfg] = useState<AiCfg | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setCfg((s.ai_review as AiCfg) ?? { enabled: false, api_key: "", model: "claude-opus-5-5" }));
  }, []);

  if (!cfg) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;

  async function save() {
    const saved = await api.updateSettings({ ai_review: cfg });
    setCfg(saved.ai_review as AiCfg);
    setMsg("Saved.");
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="card p-4 text-sm text-ink-muted space-y-2">
        <p><span className="text-ink font-medium">Optional and off by default.</span> When enabled, the Reports page can ask Claude to write a weekly or monthly review.</p>
        <p>It sends an anonymized statistics summary &mdash; KPIs, setup and mistake totals, discipline counts &mdash; with no account names, trade notes or lessons. Each review is billed to your Anthropic API key.</p>
      </div>
      <div className="card p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          Enable AI weekly review
        </label>
        <div>
          <label className="label">Anthropic API key</label>
          <input className="input font-mono" type="password" autoComplete="off" value={cfg.api_key}
            placeholder="sk-ant-…" onChange={(e) => setCfg({ ...cfg, api_key: e.target.value })} />
          <p className="text-[11px] text-ink-faint mt-1">Stored only in your local database and never shown in full again.{cfg.api_key_set ? " A key is saved." : ""}</p>
        </div>
        <div>
          <label className="label">Model</label>
          <input className="input font-mono" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
          <p className="text-[11px] text-ink-faint mt-1">Default <span className="font-mono">claude-opus-5-5</span>. Use <span className="font-mono">claude-sonnet-5-5</span> for a cheaper review.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save}>Save</button>
          {msg && <span className="text-pos text-sm">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
