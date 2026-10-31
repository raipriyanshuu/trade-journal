import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, DailySession, TradeSummary } from "../lib/api";
import { useReference } from "../lib/useReference";
import { useConfig } from "../lib/config";
import { formatMoney, formatTimeOnly, localInputToUtcIso, pnlColor, utcIsoToLocalInput } from "../lib/format";
import ManualTradeForm from "../components/trades/ManualTradeForm";
import ScrollX from "../components/ScrollX";
import {
  GradeBadge, GradePicker, HtfBadge, HtfPicker, MistakeChips, ResultBadge, StyleBadge, TagChips,
} from "../components/journal/Pickers";

type Step = "plan" | "execute" | "review";
interface Scenario { name: string; trigger: string; entry: string; stop: string; targets: string; invalidation: string; probability?: string }
interface NewsEvent { time: string; label: string }

const PROB_BUCKETS = ["0-25", "25-35", "35-50", "50-65", "65-75", "75-85", "85-90", "90-100"];

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return isoDay(d);
}
function prettyDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

const blank = (date: string, accountId: number | null): Partial<DailySession> => ({
  trading_date: date, account_id: accountId, levels: [], scenarios: [], news_events: [], readiness: [],
  htf_read: "", market_context: "", what_to_repeat: "", what_to_change: "", key_lesson: "", focus_tomorrow: "",
});

export default function Journal() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { tz } = useConfig();
  const { accounts } = useReference();
  const [date, setDate] = useState(params.get("date") || isoDay(new Date()));
  const [accountId, setAccountId] = useState<number | null>(params.get("account") ? Number(params.get("account")) : null);
  const [form, setForm] = useState<Partial<DailySession>>(blank(date, accountId));
  const [prev, setPrev] = useState<DailySession | null>(null);
  const [template, setTemplate] = useState<string[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [step, setStep] = useState<Step>("plan");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [logMode, setLogMode] = useState<"taken" | "missed" | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setTemplate((s.readiness_template as string[]) ?? []));
  }, []);

  const loadTrades = useCallback(() => {
    api.listTrades({ date_from: date, date_to: date, account_id: accountId ?? undefined, sort_by: "open_time", order: "asc" })
      .then(setTrades);
  }, [date, accountId]);

  useEffect(() => {
    setDirty(false);
    setSavedAt(null);
    Promise.all([api.getJournal(date, accountId), api.previousJournal(date, accountId)]).then(([cur, p]) => {
      setForm(cur ?? blank(date, accountId));
      setPrev(p);
    });
    loadTrades();
  }, [date, accountId, loadTrades]);

  const readiness = useMemo(() => {
    const saved = form.readiness ?? [];
    if (saved.length) return saved;
    return template.map((label) => ({ label, done: false }));
  }, [form.readiness, template]);

  function set<K extends keyof DailySession>(k: K, v: DailySession[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await api.upsertJournal({ ...(form as DailySession), readiness, trading_date: date, account_id: accountId });
      setForm(saved);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } finally {
      setSaving(false);
    }
  }

  async function goStep(s: Step) {
    if (dirty) await save();
    setStep(s);
  }

  function copyPrevLevels() {
    if (!prev) return;
    setForm((f) => ({ ...f, levels: prev.levels, scenarios: prev.scenarios }));
    setDirty(true);
  }

  // Step completion for the stepper.
  const closed = trades.filter((t) => t.status === "closed");
  const missed = trades.filter((t) => t.status === "missed");
  const planDone = !!(form.htf_bias || form.market_context || (form.levels?.length ?? 0) > 0 || (form.scenarios?.length ?? 0) > 0);
  const execDone = trades.length > 0;
  const reviewDone = !!(form.day_grade || form.followed_plan || form.key_lesson);

  const dayNet: Record<string, number> = {};
  for (const t of closed) if (t.pnl_known) dayNet[t.currency] = (dayNet[t.currency] ?? 0) + Number(t.net_pnl);
  const wins = closed.filter((t) => t.result === "win").length;
  const losses = closed.filter((t) => t.result === "loss").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-faint">Trading day</div>
          <div className="flex items-center gap-2 mt-1">
            <button className="btn-ghost !px-2 !py-1" onClick={() => setDate(shiftDay(date, -1))}>&larr;</button>
            <h1 className="text-2xl font-semibold">{prettyDay(date)}</h1>
            <button className="btn-ghost !px-2 !py-1" onClick={() => setDate(shiftDay(date, 1))}>&rarr;</button>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="input !w-auto" value={accountId ?? ""} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_demo ? " (demo)" : ""}</option>)}
          </select>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>
      {savedAt && !dirty && <p className="text-xs text-ink-faint -mt-2 mb-3">Saved at {savedAt}</p>}

      {/* Stepper */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {([
          ["plan", "1", "Plan", "Bias, context, levels, scenarios", planDone],
          ["execute", "2", "Execute", `${trades.length} logged · ${missed.length} missed`, execDone],
          ["review", "3", "Review", "Grade the day, lessons, focus", reviewDone],
        ] as [Step, string, string, string, boolean][]).map(([key, n, title, sub, done]) => (
          <button key={key} onClick={() => goStep(key)}
            className={`card p-3 text-left flex items-center gap-3 transition ${step === key ? "ring-1 ring-accent bg-accent/10" : "hover:bg-card-hover"}`}>
            <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${done ? "bg-pos/20 text-pos" : step === key ? "bg-accent/30 text-ink" : "bg-card-border text-ink-faint"}`}>
              {done ? "✓" : n}
            </span>
            <span>
              <span className="block font-medium">{title}</span>
              <span className="block text-xs text-ink-faint">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      {step === "plan" && (
        <PlanStep form={form} set={set} readiness={readiness} prev={prev} date={date} tz={tz} onCopyPrev={copyPrevLevels} />
      )}

      {step === "execute" && (
        <div className="space-y-4">
          <PlanStrip form={form} />
          <div className="flex flex-wrap items-center gap-3">
            <Stat label="Day P&L" value={Object.keys(dayNet).length ? Object.entries(dayNet).map(([c, v]) => formatMoney(v, c)).join("  ") : "—"}
              cls={pnlColor(Object.values(dayNet)[0] ?? 0)} />
            <Stat label="Trades" value={String(closed.length)} />
            <Stat label="W / L" value={`${wins} / ${losses}`} />
            <Stat label="Missed" value={String(missed.length)} />
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={() => setLogMode("missed")}>+ Missed setup</button>
              <button className="btn-primary" onClick={() => setLogMode("taken")}>+ Log trade</button>
            </div>
          </div>
          <DayTable trades={trades} tz={tz} onOpen={(id) => nav(`/trades/${id}`)} />
        </div>
      )}

      {step === "review" && <ReviewStep form={form} set={set} trades={trades} />}

      {logMode && (
        <ManualTradeForm initialMode={logMode} defaultAccountId={accountId} defaultDate={date}
          onClose={() => setLogMode(null)}
          onCreated={() => { setLogMode(null); loadTrades(); }} />
      )}
    </div>
  );
}

/* ----------------------------- Plan ----------------------------- */

function PlanStep({ form, set, readiness, prev, date, tz, onCopyPrev }: {
  form: Partial<DailySession>;
  set: <K extends keyof DailySession>(k: K, v: DailySession[K]) => void;
  readiness: { label: string; done: boolean }[];
  prev: DailySession | null;
  date: string;
  tz: string;
  onCopyPrev: () => void;
}) {
  const levels = form.levels ?? [];
  const scenarios = (form.scenarios as unknown as Scenario[]) ?? [];
  const news = (form.news_events as unknown as NewsEvent[]) ?? [];
  const [showStructure, setShowStructure] = useState(false);
  const readyCount = readiness.filter((r) => r.done).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card title="Higher-timeframe bias">
          <HtfPicker label="Where is the bigger picture pointing?" value={form.htf_bias} onChange={(v) => set("htf_bias", v)} big />
          <Area label="HTF read" value={form.htf_read ?? ""} onChange={(v) => set("htf_read", v)} placeholder="Weekly/daily structure, value migration, key references…" />
        </Card>

        <Card title="Market context & thesis">
          <Area label="What is the market doing today, and what is your thesis?" value={form.market_context ?? ""}
            onChange={(v) => set("market_context", v)} placeholder="Overnight was down in balance; 7850 put wall below. If we hold VAL, look for longs back to POC…" rows={4} />
          <button className="text-xs text-accent-soft hover:underline mt-2" onClick={() => setShowStructure((s) => !s)}>
            {showStructure ? "Hide" : "Show"} auction structure (prior value, overnight)
          </button>
          {showStructure && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              <Txt label="Prior day type" value={form.prior_day_type} onChange={(v) => set("prior_day_type", v)} />
              <Txt label="Profile shape" value={form.prior_profile_shape} onChange={(v) => set("prior_profile_shape", v)} />
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
          )}
        </Card>

        <Card title="Key levels" action={prev ? <button className="text-xs text-accent-soft hover:underline" onClick={onCopyPrev}>Copy from {prev.trading_date}</button> : undefined}>
          <div className="space-y-1.5">
            {levels.map((lv, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input className="input" placeholder="label (e.g. Prior VAL)" value={lv.label}
                  onChange={(e) => set("levels", levels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className="input font-mono" placeholder="price" value={lv.price}
                  onChange={(e) => set("levels", levels.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button className="btn-ghost px-2 text-ink-faint" onClick={() => set("levels", levels.filter((_, j) => j !== i))}>&times;</button>
              </div>
            ))}
          </div>
          {levels.length < 6 && (
            <button className="text-xs text-accent-soft hover:underline mt-2" onClick={() => set("levels", [...levels, { label: "", price: "" }])}>+ add level</button>
          )}
        </Card>

        <Card title="Scenarios">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {["A", "B", "C"].map((name) => {
              const s = scenarios.find((x) => x.name === name) ?? { name, trigger: "", entry: "", stop: "", targets: "", invalidation: "" };
              const update = (field: keyof Scenario, value: string) =>
                set("scenarios", [...scenarios.filter((x) => x.name !== name), { ...s, [field]: value }] as unknown as DailySession["scenarios"]);
              return (
                <div key={name} className="bg-bg-soft rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-accent-soft">Scenario {name}</span>
                    <select className="input !w-auto !py-0.5 text-xs" value={s.probability ?? ""} onChange={(e) => update("probability", e.target.value)}>
                      <option value="">prob %</option>
                      {PROB_BUCKETS.map((p) => <option key={p} value={p}>{p}%</option>)}
                    </select>
                  </div>
                  {(["trigger", "entry", "stop", "targets", "invalidation"] as (keyof Scenario)[]).map((f) => (
                    <input key={f} className="input !py-1 text-xs" placeholder={f} value={(s[f] as string) ?? ""} onChange={(e) => update(f, e.target.value)} />
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={`Readiness · ${readyCount}/${readiness.length}`}>
          <div className="h-1.5 rounded bg-card-border mb-3 overflow-hidden">
            <div className="h-full bg-pos transition-all" style={{ width: `${readiness.length ? (readyCount / readiness.length) * 100 : 0}%` }} />
          </div>
          <div className="space-y-1.5">
            {readiness.map((r, i) => (
              <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={r.done}
                  onChange={(e) => set("readiness", readiness.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
                <span className={r.done ? "text-ink-muted line-through" : ""}>{r.label}</span>
              </label>
            ))}
          </div>
        </Card>

        {prev && (prev.key_lesson || prev.focus_tomorrow) && (
          <Card title={`Carried from ${prev.trading_date}`}>
            {prev.focus_tomorrow && (
              <div className="mb-2">
                <div className="text-xs text-ink-faint">Focus for today</div>
                <p className="text-sm text-warn">{prev.focus_tomorrow}</p>
              </div>
            )}
            {prev.key_lesson && (
              <div>
                <div className="text-xs text-ink-faint">Last lesson</div>
                <p className="text-sm text-ink-muted">{prev.key_lesson}</p>
              </div>
            )}
          </Card>
        )}

        <Card title="News today">
          <div className="space-y-1.5">
            {news.map((n, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                <input type="time" className="input !w-28 !py-1" value={n.time ? utcIsoToLocalInput(n.time, tz).slice(11, 16) : ""}
                  onChange={(e) => set("news_events", news.map((x, j) => (j === i ? { ...x, time: localInputToUtcIso(`${date}T${e.target.value}`) } : x)) as unknown as DailySession["news_events"])} />
                <input className="input !py-1" placeholder="CPI, FOMC, EIA…" value={n.label}
                  onChange={(e) => set("news_events", news.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) as unknown as DailySession["news_events"])} />
                <button className="btn-ghost px-2 text-ink-faint" onClick={() => set("news_events", news.filter((_, j) => j !== i) as unknown as DailySession["news_events"])}>&times;</button>
              </div>
            ))}
          </div>
          <button className="text-xs text-accent-soft hover:underline mt-2"
            onClick={() => set("news_events", [...news, { time: "", label: "" }] as unknown as DailySession["news_events"])}>+ add event</button>
          <p className="text-[11px] text-ink-faint mt-2">Trades near these times are flagged NEWS_WINDOW.</p>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- Execute ----------------------------- */

function PlanStrip({ form }: { form: Partial<DailySession> }) {
  const scenarios = ((form.scenarios as unknown as Scenario[]) ?? []).filter((s) => s.trigger || s.entry);
  if (!form.htf_bias && !form.market_context && scenarios.length === 0) {
    return <div className="card p-3 text-sm text-ink-faint">No plan written for this day. Plan first &mdash; it makes the review honest.</div>;
  }
  return (
    <div className="card p-3 bg-accent/5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="text-xs uppercase tracking-wider text-ink-faint">Your plan</span>
      <HtfBadge value={form.htf_bias} />
      {form.market_context && <span className="text-ink-muted truncate max-w-md">{form.market_context}</span>}
      {scenarios.sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
        <span key={s.name} className="text-ink-muted">
          <span className="text-accent-soft font-semibold">{s.name}</span>{s.probability ? ` (${s.probability}%)` : ""}: {s.trigger || s.entry}
        </span>
      ))}
    </div>
  );
}

function DayTable({ trades, tz, onOpen }: { trades: TradeSummary[]; tz: string; onOpen: (id: number) => void }) {
  if (trades.length === 0) {
    return <div className="card p-10 text-center text-ink-muted">Nothing logged yet. Log each trade &mdash; and every setup you saw but didn&rsquo;t take.</div>;
  }
  return (
    <ScrollX>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-faint border-b border-card-border whitespace-nowrap">
            {["Instrument", "Style", "Lot", "Time", "DTR/ATR", "Dir", "Prob", "What happened", "Result", "Trade type", "Mistakes", "Emotion", "Entry Q", "Exit Q", "Location", "HTF", "P&L"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-b border-card-border/40 hover:bg-card-hover cursor-pointer align-top" onClick={() => onOpen(t.id)}>
              <td className="px-3 py-2 font-mono font-semibold">{t.symbol}</td>
              <td className="px-3 py-2"><StyleBadge style={t.style} /></td>
              <td className="px-3 py-2 font-mono">{t.max_position_size}</td>
              <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{t.time_known ? formatTimeOnly(t.open_time, tz) : "~"}</td>
              <td className="px-3 py-2 font-mono text-ink-muted">{t.dtr && t.atr ? `${Number(t.dtr)}/${Number(t.atr)}` : "—"}</td>
              <td className="px-3 py-2"><span className={`badge ${t.direction === "long" ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"}`}>{t.direction === "long" ? "Long" : "Short"}</span></td>
              <td className="px-3 py-2"><TagChips tags={t.tags} category="probability" /></td>
              <td className="px-3 py-2"><TagChips tags={t.tags} category="thesis" /></td>
              <td className="px-3 py-2"><ResultBadge result={t.result} partial={t.partial_profit} /></td>
              <td className="px-3 py-2"><TagChips tags={t.tags} category="setup" /></td>
              <td className="px-3 py-2"><MistakeChips trade={t} /></td>
              <td className="px-3 py-2"><TagChips tags={t.tags} category="emotion" /></td>
              <td className="px-3 py-2"><GradeBadge grade={t.entry_quality} /></td>
              <td className="px-3 py-2"><GradeBadge grade={t.exit_quality} /></td>
              <td className="px-3 py-2"><TagChips tags={t.tags} category="location" /></td>
              <td className="px-3 py-2"><HtfBadge value={t.htf_alignment} /></td>
              <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${t.status === "missed" || !t.pnl_known ? "text-ink-faint" : pnlColor(t.net_pnl)}`}>
                {t.status === "missed" ? (t.r_multiple ? `~${t.r_multiple}R` : "—") : t.pnl_known ? formatMoney(t.net_pnl, t.currency) : "label"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

/* ----------------------------- Review ----------------------------- */

function ReviewStep({ form, set, trades }: {
  form: Partial<DailySession>;
  set: <K extends keyof DailySession>(k: K, v: DailySession[K]) => void;
  trades: TradeSummary[];
}) {
  const closed = trades.filter((t) => t.status === "closed");
  const missed = trades.filter((t) => t.status === "missed");
  const bias = form.htf_bias;
  const aligned = bias && bias !== "range"
    ? closed.filter((t) => (bias === "bullish") === (t.direction === "long")).length : null;
  const gradeScore: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };
  const graded = closed.filter((t) => t.entry_quality);
  const avgEntry = graded.length ? graded.reduce((s, t) => s + (gradeScore[t.entry_quality!] ?? 0), 0) / graded.length : null;
  const mistakeTrades = closed.filter(
    (t) => t.tags.some((g) => g.category === "mistake") || (t.manual_flags?.length ?? 0) > 0,
  ).length;
  const thesisHeld = closed.filter((t) => t.tags.some((g) => g.category === "thesis" && /held|continu/i.test(g.name))).length;
  const net: Record<string, number> = {};
  for (const t of closed) if (t.pnl_known) net[t.currency] = (net[t.currency] ?? 0) + Number(t.net_pnl);
  const scoreToGrade = (s: number) => (s >= 3.5 ? "A+" : s >= 2.5 ? "A" : s >= 1.5 ? "B" : "C");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card title="Plan vs reality">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-faint">Expected</div>
              <div className="flex items-center gap-2 text-sm"><span className="text-ink-faint w-20">HTF bias</span><HtfBadge value={form.htf_bias} /></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-ink-faint w-20">Open</span><span>{form.expected_open_location || "—"}</span></div>
              <div className="text-sm text-ink-muted whitespace-pre-wrap">{form.market_context || "No thesis written."}</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-faint">What actually happened</div>
              <Txt label="Opening type" value={form.actual_opening_type} onChange={(v) => set("actual_opening_type", v)} placeholder="Open drive, test drive, auction in range…" />
              <Txt label="Day type" value={form.actual_day_type} onChange={(v) => set("actual_day_type", v)} placeholder="Trend up, normal variation, balance…" />
              <div>
                <label className="label">Scenario that played out</label>
                <div className="flex gap-1">
                  {["A", "B", "C", "none"].map((s) => (
                    <button key={s} type="button" onClick={() => set("scenario_played_out", form.scenario_played_out === s ? null : s)}
                      className={`btn flex-1 !py-1 text-xs ${form.scenario_played_out === s ? "bg-accent/25 text-ink" : "bg-card-hover text-ink-faint"}`}>
                      {s === "none" ? "None" : s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-ink-faint mt-3">Tip: a day type containing &ldquo;trend up/down&rdquo; lets the engine flag counter-trend trades (FADED_TREND_DAY).</p>
        </Card>

        <Card title="Reflection">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Area label="What to repeat" value={form.what_to_repeat ?? ""} onChange={(v) => set("what_to_repeat", v)} />
            <Area label="What to change" value={form.what_to_change ?? ""} onChange={(v) => set("what_to_change", v)} />
            <Area label="Key lesson (one sentence)" value={form.key_lesson ?? ""} onChange={(v) => set("key_lesson", v)} />
            <Area label="Focus for tomorrow" value={form.focus_tomorrow ?? ""} onChange={(v) => set("focus_tomorrow", v)}
              placeholder="Shows on tomorrow's Plan step." />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Auto scorecard">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Score label="Net P&L" value={Object.keys(net).length ? Object.entries(net).map(([c, v]) => formatMoney(v, c)).join(" ") : "—"}
              cls={pnlColor(Object.values(net)[0] ?? 0)} />
            <Score label="Trades / missed" value={`${closed.length} / ${missed.length}`} />
            <Score label="With HTF bias" value={aligned === null ? "—" : `${aligned}/${closed.length}`} />
            <Score label="Avg entry quality" value={avgEntry === null ? "—" : scoreToGrade(avgEntry)} />
            <Score label="Thesis held" value={`${thesisHeld}/${closed.length}`} />
            <Score label="Mistake trades" value={String(mistakeTrades)} cls={mistakeTrades ? "text-neg" : "text-pos"} />
          </div>
        </Card>

        <Card title="Grade the day">
          <div className="space-y-3">
            <GradePicker label="Day grade (process, not P&L)" value={form.day_grade} onChange={(v) => set("day_grade", v)} />
            <div>
              <label className="label">Followed the plan?</label>
              <div className="flex gap-1">
                {[["yes", "Yes", "bg-pos/20 text-pos"], ["partly", "Partly", "bg-warn/20 text-warn"], ["no", "No", "bg-neg/20 text-neg"]].map(([k, l, tone]) => (
                  <button key={k} type="button" onClick={() => set("followed_plan", form.followed_plan === k ? null : k)}
                    className={`btn flex-1 !py-1 text-xs ${form.followed_plan === k ? tone : "bg-card-hover text-ink-faint"}`}>{l}</button>
                ))}
              </div>
            </div>
            <Scale label="Mood" value={form.mood} onChange={(v) => set("mood", v)} />
            <Scale label="Sleep" value={form.sleep} onChange={(v) => set("sleep", v)} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- bits ----------------------------- */

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={`font-mono font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
function Score({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={`font-mono font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
function Scale({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="label">{label} (1-5)</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(value === n ? null : n)}
            className={`btn flex-1 !py-1 text-xs ${value === n ? "bg-accent/25 text-ink" : "bg-card-hover text-ink-faint"}`}>{n}</button>
        ))}
      </div>
    </div>
  );
}
function Txt({ label, value, onChange, mono, placeholder }: { label: string; value: string | null | undefined; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className={`input ${mono ? "font-mono" : ""}`} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Area({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div className="mt-2">
      <label className="label">{label}</label>
      <textarea className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
