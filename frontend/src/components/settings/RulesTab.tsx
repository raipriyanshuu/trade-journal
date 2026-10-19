import { useEffect, useState } from "react";
import { api } from "../../lib/api";

// Known numeric thresholds per rule.
const THRESHOLDS: Record<string, [string, string][]> = {
  REVENGE: [["minutes", "Minutes"]],
  TWO_STRIKES: [["losses", "Losses"]],
  OVERTRADING: [["max_trades", "Max trades"]],
  LOSS_EXCEEDS_PLAN: [["tolerance_pct", "Tolerance %"]],
  FIRST_MINUTES: [["minutes", "Minutes"]],
  NEWS_WINDOW: [["minutes", "Minutes"]],
  HELD_LOSERS: [["ratio", "Ratio"]],
};

export default function RulesTab() {
  const [rules, setRules] = useState<Record<string, any>>({});
  const [explain, setExplain] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getMistakeRules().then((r) => { setRules(r.rules); setExplain(r.explanations); });
  }, []);

  function setField(code: string, key: string, value: any) {
    setRules((r) => ({ ...r, [code]: { ...r[code], [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.updateSettings({ mistake_rules: rules });
      const res = await api.recomputeMistakes();
      setMsg(`Saved and recomputed (${res.flags} flags).`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-sm text-ink-muted">Toggle each rule and tune its thresholds. Saving recomputes all auto flags.</p>
      <div className="card divide-y divide-card-border">
        {Object.keys(rules).map((code) => (
          <div key={code} className="p-3 flex items-center gap-3">
            <input type="checkbox" checked={!!rules[code]?.enabled} onChange={(e) => setField(code, "enabled", e.target.checked)} />
            <div className="flex-1">
              <div className="font-mono text-sm font-medium">{code}</div>
              <div className="text-xs text-ink-faint">{explain[code]}</div>
            </div>
            <div className="flex gap-2">
              {(THRESHOLDS[code] ?? []).map(([key, lbl]) => (
                <div key={key}>
                  <span className="text-xs text-ink-faint block">{lbl}</span>
                  <input className="input !w-20 font-mono !py-1" value={rules[code]?.[key] ?? ""} onChange={(e) => setField(code, key, Number(e.target.value))} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save & recompute"}</button>
        {msg && <span className="text-pos text-sm">{msg}</span>}
      </div>
    </div>
  );
}
