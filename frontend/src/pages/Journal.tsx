import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, DailySession, TradeSummary } from "../lib/api";
import { useReference } from "../lib/useReference";
import { formatMoney, pnlColor } from "../lib/format";

const EMPTY = (date: string, accountId: number | null): Partial<DailySession> => ({
  trading_date: date,
  account_id: accountId,
  levels: [],
  scenarios: [],
  news_events: [],
  htf_read: "",
  what_to_repeat: "",
  what_to_change: "",
});

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Journal() {
  const nav = useNavigate();
  const { accounts } = useReference();
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<DailySession>>(EMPTY(date, null));
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.getJournal(date, accountId).then((d) => setForm(d ?? EMPTY(date, accountId)));
    api.listTrades({ date_from: date, date_to: date, account_id: accountId ?? undefined }).then(setTrades);
  }, [date, accountId]);

  useEffect(load, [load]);

  function set<K extends keyof DailySession>(k: K, v: DailySession[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.upsertJournal({ ...(form as DailySession), trading_date: date, account_id: accountId });
      setForm(saved);
      setMsg("Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPrevious() {
    const prev = await api.previousJournal(date, accountId);
    if (!prev) {
      setMsg("No earlier journal to copy from.");
      return;
    }
    setForm((f) => ({
      ...f,
      levels: prev.levels,
      prior_vah: prev.on_high ?? f.prior_vah,
      prior_val: prev.on_low ?? f.prior_val,
      scenarios: prev.scenarios,
    }));
    setMsg(`Copied levels from ${prev.trading_date}.`);
  }

  const dayPnl = trades.reduce((acc, t) => {
    acc[t.currency] = (acc[t.currency] ?? 0) + Number(t.net_pnl);
    return acc;
  }, {} as Record<string, number>);

  const levels = form.levels ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Daily Journal</h1>
        <div className="flex items-end gap-2">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Account</label>
            <select className="input !w-auto" value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">All (account-wide)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <button className="btn-ghost" onClick={copyPrevious}>Copy prev levels</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {msg && <p className="text-pos text-sm mb-3">{msg}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Morning plan */}
          <Card title="Morning plan">
            <Area label="HTF read" value={form.htf_read ?? ""} onChange={(v) => set("htf_read", v)} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Txt label="Prior day type" value={form.prior_day_type} onChange={(v) => set("prior_day_type", v)} />
              <Txt label="Prior profile" value={form.prior_profile_shape} onChange={(v) => set("prior_profile_shape", v)} />
              <Txt label="Prior VAH" value={form.prior_vah} onChange={(v) => set("prior_vah", v)} mono />
              <Txt label="Prior POC" value={form.prior_poc} onChange={(v) => set("prior_poc", v)} mono />
              <Txt label="Prior VAL" value={form.prior_val} onChange={(v) => set("prior_val", v)} mono />
              <Txt label="ON high" value={form.on_high} onChange={(v) => set("on_high", v)} mono />
              <Txt label="ON low" value={form.on_low} onChange={(v) => set("on_low", v)} mono />
              <Txt label="ON POC" value={form.on_poc} onChange={(v) => set("on_poc", v)} mono />
              <Txt label="ON VWAP" value={form.on_vwap} onChange={(v) => set("on_vwap", v)} mono />
              <Txt label="ON range vs ATR" value={form.on_range_vs_atr} onChange={(v) => set("on_range_vs_atr", v)} />
              <Txt label="ON inventory" value={form.on_inventory} onChange={(v) => set("on_inventory", v)} />
              <Txt label="Expected open" value={form.expected_open_location} onChange={(v) => set("expected_open_location", v)} />
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Levels (up to 6)</label>
                {levels.length < 6 && (
                  <button className="text-accent-soft text-xs hover:underline"
                    onClick={() => set("levels", [...levels, { label: "", price: "" }])}>+ add level</button>
                )}
              </div>
              <div className="space-y-1.5">
                {levels.map((lv, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input className="input" placeholder="label" value={lv.label}
                      onChange={(e) => set("levels", levels.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                    <input className="input font-mono" placeholder="price" value={lv.price}
                      onChange={(e) => set("levels", levels.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                    <button className="btn-ghost px-2 text-ink-faint" onClick={() => set("levels", levels.filter((_, j) => j !== i))}>&times;</button>
                  </div>
                ))}
              </div>
            </div>

            <ScenarioEditor
              scenarios={(form.scenarios as unknown as ScenarioT[]) ?? []}
              onChange={(s) => set("scenarios", s as unknown as DailySession["scenarios"])}
            />
          </Card>

          {/* Evening review */}
          <Card title="Evening review">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Txt label="Actual opening type" value={form.actual_opening_type} onChange={(v) => set("actual_opening_type", v)} />
              <Txt label="Actual day type" value={form.actual_day_type} onChange={(v) => set("actual_day_type", v)} />
              <Txt label="Scenario played out" value={form.scenario_played_out} onChange={(v) => set("scenario_played_out", v)} />
              <div>
                <label className="label">Followed plan?</label>
                <select className="input" value={form.followed_plan ?? ""} onChange={(e) => set("followed_plan", e.target.value)}>
                  <option value="">&mdash;</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option>
                </select>
              </div>
              <Num label="Mood (1-5)" value={form.mood} onChange={(v) => set("mood", v)} />
              <Num label="Sleep (1-5)" value={form.sleep} onChange={(v) => set("sleep", v)} />
            </div>
            <Area label="What to repeat" value={form.what_to_repeat ?? ""} onChange={(v) => set("what_to_repeat", v)} />
            <Area label="What to change" value={form.what_to_change ?? ""} onChange={(v) => set("what_to_change", v)} />
          </Card>
        </div>

        {/* That day's trades */}
        <div>
          <Card title="This day's trades">
            <div className="flex gap-3 text-sm mb-2">
              {Object.entries(dayPnl).map(([ccy, sum]) => (
                <span key={ccy} className={`font-mono ${pnlColor(sum)}`}>{formatMoney(sum, ccy)}</span>
              ))}
              {trades.length === 0 && <span className="text-ink-faint">No trades.</span>}
            </div>
            <div className="space-y-1">
              {trades.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-card-hover cursor-pointer" onClick={() => nav(`/trades/${t.id}`)}>
                  <span className="font-mono text-sm">{t.symbol} <span className={t.direction === "long" ? "text-pos" : "text-neg"}>{t.direction}</span></span>
                  <span className={`font-mono text-sm ${pnlColor(t.net_pnl)}`}>{formatMoney(t.net_pnl, t.currency)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface ScenarioT { name: string; trigger: string; entry: string; stop: string; targets: string; invalidation: string; }

function ScenarioEditor({ scenarios, onChange }: { scenarios: ScenarioT[]; onChange: (s: ScenarioT[]) => void }) {
  const names = ["A", "B", "C"];
  function get(name: string): ScenarioT {
    return scenarios.find((s) => s.name === name) ?? { name, trigger: "", entry: "", stop: "", targets: "", invalidation: "" };
  }
  function update(name: string, field: keyof ScenarioT, value: string) {
    const others = scenarios.filter((s) => s.name !== name);
    onChange([...others, { ...get(name), [field]: value }]);
  }
  return (
    <div className="mt-3">
      <label className="label">Scenarios</label>
      <div className="space-y-2">
        {names.map((n) => {
          const s = get(n);
          return (
            <div key={n} className="bg-bg-soft rounded-lg p-2">
              <div className="text-xs text-accent-soft font-medium mb-1">Scenario {n}</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {(["trigger", "entry", "stop", "targets", "invalidation"] as (keyof ScenarioT)[]).map((f) => (
                  <input key={f} className="input text-xs" placeholder={f} value={s[f]}
                    onChange={(e) => update(n, f, e.target.value)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}
function Txt({ label, value, onChange, mono }: { label: string; value: string | null | undefined; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className={`input ${mono ? "font-mono" : ""}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Num({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">&mdash;</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}
function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-2">
      <label className="label">{label}</label>
      <textarea className="input min-h-[60px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
