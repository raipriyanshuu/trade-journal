import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api, ReportCard, ReportCardConfig, ReportCardFields, ReportCardTrade, RCSegment, Shape,
} from "../lib/api";
import { formatMoney, formatTimeOnly, pnlColor } from "../lib/format";
import { useConfig } from "../lib/config";
import { GRADES, gradeTone, SideBadge, TagChips } from "../components/journal/Pickers";
import { AnnotatedThumb } from "../components/annotate/Annotations";
import EditableText from "../components/EditableText";
import Lightbox from "../components/Lightbox";
import GradeCalendar from "../components/reportcard/GradeCalendar";

const todayIso = () => new Date().toLocaleDateString("en-CA");
const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString("en-CA");
};
export const prettyDay = (d: string, long = true) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", long
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { weekday: "short", day: "numeric", month: "short" });

const FIELDS: (keyof ReportCardFields)[] = [
  "goal", "goal_result", "segments", "overview", "easiest_money", "grade", "learned", "changes", "goal_tomorrow",
];
const pick = (c: ReportCard): ReportCardFields =>
  Object.fromEntries(FIELDS.map((k) => [k, c[k]])) as unknown as ReportCardFields;

const DEFAULT_CFG: ReportCardConfig = { segments: [], columns: [], reminders: [] };
const GOAL_RESULTS = [
  { key: "hit", label: "Hit it", tone: "bg-pos/20 text-pos" },
  { key: "partly", label: "Partly", tone: "bg-warn/20 text-warn" },
  { key: "missed", label: "Missed", tone: "bg-neg/20 text-neg" },
];

export default function ReportCardPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || todayIso();
  const setDate = (d: string) => setParams({ date: d });
  const [card, setCard] = useState<ReportCard | null>(null);
  const [draft, setDraft] = useState<ReportCardFields | null>(null);
  const [cfg, setCfg] = useState<ReportCardConfig>(DEFAULT_CFG);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [calKey, setCalKey] = useState(0);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef<{ date: string; draft: ReportCardFields | null; dirty: boolean }>({ date, draft: null, dirty: false });

  useEffect(() => {
    api.getSettings().then((s) => setCfg({ ...DEFAULT_CFG, ...((s.report_card as ReportCardConfig) ?? {}) }));
  }, []);

  const save = useCallback(() => {
    const { date: d, draft: body, dirty } = latest.current;
    if (!body || !dirty) return saving.current;
    latest.current.dirty = false;
    setStatus("saving");
    saving.current = saving.current.then(() => api.saveReportCard(d, body)).then((r) => {
      // Keep what's being typed; take only the server's derived bits.
      setCard((c) => (c && c.date === r.date ? { ...c, exists: true, goal_streak: r.goal_streak, prev_card: r.prev_card, next_card: r.next_card } : c));
      setStatus(latest.current.dirty ? "dirty" : "saved");
      setCalKey((k) => k + 1);
    }).catch((e) => { setErr((e as Error).message); setStatus("error"); latest.current.dirty = true; });
    return saving.current;
  }, []);

  // Load a day (after saving the one you're leaving).
  useEffect(() => {
    let live = true;
    (async () => {
      await save();
      setCard(null);
      setDraft(null);
      try {
        const c = await api.reportCard(date);
        if (!live) return;
        setCard(c);
        setDraft(pick(c));
        latest.current = { date, draft: pick(c), dirty: false };
        setStatus(c.exists ? "saved" : "idle");
        setErr(null);
      } catch (e) {
        if (live) setErr((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, [date, save]);

  // Autosave shortly after you stop typing.
  useEffect(() => {
    if (status !== "dirty") return;
    const t = setTimeout(save, 900);
    return () => clearTimeout(t);
  }, [draft, status, save]);

  useEffect(() => {
    const flush = () => { if (latest.current.dirty) save(); };
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("beforeunload", flush); flush(); };
  }, [save]);

  function set<K extends keyof ReportCardFields>(k: K, v: ReportCardFields[K]) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [k]: v };
      latest.current = { date, draft: next, dirty: true };
      return next;
    });
    setStatus("dirty");
  }

  async function saveCfg(next: ReportCardConfig) {
    setCfg(next);
    await api.updateSettings({ report_card: next });
  }

  return (
    <div>
      <div className="no-print">
        <GradeCalendar selected={date} onSelect={setDate} refreshKey={calKey} />
      </div>
      {err && <p className="text-neg text-sm mb-3 no-print">{err}</p>}
      {!card || !draft ? (
        <p className="text-ink-muted text-sm">Loading…</p>
      ) : (
        <CardView card={card} draft={draft} set={set} cfg={cfg} saveCfg={saveCfg} status={status}
          setDate={setDate} onTrades={(trades) => setCard({ ...card, trades })} />
      )}
    </div>
  );
}

function CardView({ card, draft, set, cfg, saveCfg, status, setDate, onTrades }: {
  card: ReportCard;
  draft: ReportCardFields;
  set: <K extends keyof ReportCardFields>(k: K, v: ReportCardFields[K]) => void;
  cfg: ReportCardConfig;
  saveCfg: (c: ReportCardConfig) => Promise<void>;
  status: string;
  setDate: (d: string) => void;
  onTrades: (t: ReportCardTrade[]) => void;
}) {
  const [newReminder, setNewReminder] = useState("");
  const date = card.date;
  const carried = card.carried_over && !card.exists && draft.goal === card.carried_over.text ? card.carried_over : null;
  const goalIsReminder = cfg.reminders.some((r) => r.trim().toLowerCase() === draft.goal.trim().toLowerCase());
  const taken = card.trades.filter((t) => t.status !== "missed");
  const missed = card.trades.filter((t) => t.status === "missed");
  const netText = Object.entries(card.net).map(([c, v]) => formatMoney(v, c)).join(" · ");

  function addReminder(text: string) {
    const t = text.trim();
    if (!t || cfg.reminders.includes(t)) return;
    saveCfg({ ...cfg, reminders: [...cfg.reminders, t] });
  }

  function setSeg(i: number, patch: Partial<RCSegment>) {
    set("segments", draft.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  return (
    <div className="card p-5 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-faint">Daily report card</div>
          <div className="flex items-center gap-2 mt-1">
            <button className="btn-ghost !px-2 !py-1 no-print" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day">&larr;</button>
            <h1 className="text-2xl font-semibold">{prettyDay(date)}</h1>
            <button className="btn-ghost !px-2 !py-1 no-print" onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day">&rarr;</button>
          </div>
          <div className="text-sm text-ink-muted mt-1">
            {taken.length} trade{taken.length === 1 ? "" : "s"}
            {missed.length > 0 && <> · {missed.length} missed</>}
            {netText && <> · <span className={pnlColor(Object.values(card.net)[0])}>{netText}</span></>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Day grade">
            <span className="text-xs text-ink-faint mr-1">Grade</span>
            {GRADES.map((g) => (
              <button key={g} type="button" onClick={() => set("grade", draft.grade === g ? null : g)}
                className={`btn !px-3 !py-1.5 text-sm font-semibold ${draft.grade === g ? gradeTone(g) : "bg-card-hover text-ink-faint no-print"}`}>
                {g}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 no-print">
            <span className="text-xs text-ink-faint">
              {status === "saving" ? "Saving…" : status === "dirty" ? "Unsaved" : status === "saved" ? "Saved" : status === "error" ? "Not saved" : "New"}
            </span>
            <input type="date" className="input !w-auto !py-1" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Link to={`/journal?date=${date}`} className="btn-ghost !py-1">Trading Day</Link>
            <button className="btn-ghost !py-1" onClick={() => window.print()}>Print / PDF</button>
          </div>
        </div>
      </div>

      {/* Goal */}
      <Section title="Goal: the one thing I'm working on today">
        <AutoText value={draft.goal} onChange={(v) => set("goal", v)} placeholder="Wait for the second test of the level before entering" big />
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {carried && (
            <span className="text-xs text-ink-faint no-print">
              Carried over from {prettyDay(carried.date, false)} ({carried.from}). Edit it if today is different.
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <span className="text-xs text-ink-faint mr-1">End of day:</span>
            {GOAL_RESULTS.map((g) => (
              <button key={g.key} type="button" onClick={() => set("goal_result", draft.goal_result === g.key ? null : g.key)}
                className={`btn !px-2.5 !py-1 text-xs ${draft.goal_result === g.key ? g.tone : "bg-card-hover text-ink-faint no-print"}`}>
                {g.label}
              </button>
            ))}
          </span>
        </div>
        {draft.goal.trim() && !goalIsReminder && (
          card.goal_streak >= 3 ? (
            <div className="mt-2 text-xs rounded-lg bg-accent/10 px-3 py-2 flex items-center justify-between gap-2 no-print">
              <span>Same goal {card.goal_streak} days running. Make it a standing reminder?</span>
              <button className="btn-primary !py-1 !text-xs" onClick={() => addReminder(draft.goal)}>Add to reminders</button>
            </div>
          ) : (
            <button className="text-xs text-ink-faint hover:text-ink mt-1 no-print" onClick={() => addReminder(draft.goal)}>
              + Keep as a standing reminder
            </button>
          )
        )}
      </Section>

      {/* Reminders */}
      <Section title="Reminders to myself">
        {cfg.reminders.length === 0 && <p className="text-xs text-ink-faint">No standing reminders yet. They show on every day's card.</p>}
        <ul className="space-y-1">
          {cfg.reminders.map((r, i) => (
            <li key={i} className="group flex items-start gap-2 text-sm">
              <span className="text-ink-faint">–</span>
              <span className="flex-1">{r}</span>
              <button className="text-ink-faint hover:text-neg text-xs opacity-0 group-hover:opacity-100 no-print" aria-label={`Remove reminder ${r}`}
                onClick={() => saveCfg({ ...cfg, reminders: cfg.reminders.filter((_, j) => j !== i) })}>✕</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 mt-2 no-print">
          <input className="input !py-1 text-sm" placeholder="Above VWAP, only short a capitulation" value={newReminder}
            onChange={(e) => setNewReminder(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addReminder(newReminder); setNewReminder(""); } }} />
          <button className="btn-ghost !py-1" onClick={() => { addReminder(newReminder); setNewReminder(""); }}>Add</button>
        </div>
      </Section>

      {/* Segment table */}
      <Section title="Session by segment">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-ink-faint text-xs border-b border-card-border">
                <th className="py-2 pr-2 font-medium w-44">Segment</th>
                <th className="py-2 px-2 font-medium w-20">Grade</th>
                {cfg.columns.map((c) => <th key={c.name} className="py-2 px-2 font-medium w-28">{c.name}</th>)}
                <th className="py-2 px-2 font-medium">Comments</th>
                <th className="w-6 no-print" />
              </tr>
            </thead>
            <tbody>
              {draft.segments.map((s, i) => (
                <tr key={i} className="border-b border-card-border/50 align-top">
                  <td className="py-1 pr-2">
                    <input className="cell font-medium" value={s.name} onChange={(e) => setSeg(i, { name: e.target.value })} aria-label="Segment name" />
                  </td>
                  <td className="py-1 px-2">
                    <select className={`cell font-semibold ${s.grade ? gradeTone(s.grade) : ""}`} value={s.grade ?? ""}
                      onChange={(e) => setSeg(i, { grade: e.target.value || null })} aria-label={`${s.name} grade`}>
                      <option value="">–</option>
                      {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  {cfg.columns.map((c) => (
                    <td key={c.name} className="py-1 px-2">
                      {c.options.length ? (
                        <select className="cell" value={s.cells[c.name] ?? ""} aria-label={`${s.name} ${c.name}`}
                          onChange={(e) => setSeg(i, { cells: { ...s.cells, [c.name]: e.target.value } })}>
                          <option value="">–</option>
                          {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input className="cell" value={s.cells[c.name] ?? ""} aria-label={`${s.name} ${c.name}`}
                          onChange={(e) => setSeg(i, { cells: { ...s.cells, [c.name]: e.target.value } })} />
                      )}
                    </td>
                  ))}
                  <td className="py-1 px-2">
                    <AutoText value={s.comment} onChange={(v) => setSeg(i, { comment: v })} placeholder="–" cell />
                  </td>
                  <td className="py-1 no-print">
                    <button className="text-ink-faint hover:text-neg text-xs mt-1.5" aria-label={`Remove ${s.name}`}
                      onClick={() => set("segments", draft.segments.filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3 mt-2 text-xs no-print">
          <button className="text-ink-faint hover:text-ink"
            onClick={() => set("segments", [...draft.segments, { name: "", grade: null, cells: {}, comment: "" }])}>+ Row</button>
          <Link to="/settings?tab=reportcard" className="text-ink-faint hover:text-ink">Edit default segments and columns</Link>
        </div>
      </Section>

      {/* Reflection */}
      <div className="grid md:grid-cols-2 gap-x-6">
        <Section title="What I learned / improved on today">
          <AutoText value={draft.learned} onChange={(v) => set("learned", v)} placeholder="Shared with the Trading Day review (key lesson)." />
        </Section>
        <Section title="Changes I need to make">
          <AutoText value={draft.changes} onChange={(v) => set("changes", v)} placeholder="Shared with the Trading Day review." />
        </Section>
        <Section title="Overview of the day">
          <AutoText value={draft.overview} onChange={(v) => set("overview", v)} placeholder="Market, mood, how it went." />
        </Section>
        <Section title="Goal for tomorrow">
          <AutoText value={draft.goal_tomorrow} onChange={(v) => set("goal_tomorrow", v)} placeholder="Becomes tomorrow's goal." />
        </Section>
      </div>

      <Section title="Easiest money missed">
        <AutoText value={draft.easiest_money} onChange={(v) => set("easiest_money", v)} placeholder="The cleanest move you didn't take, and why." />
        {missed.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {missed.map((t) => (
              <li key={t.id} className="flex gap-2">
                <Link to={`/trades/${t.id}`} className="font-medium hover:text-accent-soft">{t.symbol}</Link>
                <SideBadge trade={t} />
                <span className="text-ink-muted">{t.notes || t.context || "Missed trade"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Trade write-ups */}
      <Section title="Trade write-ups">
        {taken.length === 0 ? (
          <p className="text-sm text-ink-faint">No trades on this day.</p>
        ) : (
          <div className="space-y-4">{taken.map((t) => (
            <TradeWriteup key={t.id} t={t} onSaved={(nt) => onTrades(card.trades.map((x) => (x.id === nt.id ? nt : x)))} />
          ))}</div>
        )}
      </Section>
    </div>
  );
}

function TradeWriteup({ t, onSaved }: { t: ReportCardTrade; onSaved: (t: ReportCardTrade) => void }) {
  const { tz } = useConfig();
  const [viewer, setViewer] = useState<number | null>(null);
  const src = (path: string) => `/attachments/${path}`;
  const tags = t.tags.filter((g) => ["mistake", "emotion", "setup"].includes(g.category));
  return (
    <div className="border border-card-border rounded-xl p-4 break-inside-avoid">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Link to={`/trades/${t.id}`} className="font-semibold hover:text-accent-soft">{t.symbol}</Link>
        <SideBadge trade={t} />
        <span className={`font-mono font-semibold ${pnlColor(t.net_pnl)}`}>{t.pnl_known ? formatMoney(t.net_pnl, t.currency) : "P&L unknown"}</span>
        {t.r_multiple != null && <span className="text-xs text-ink-faint font-mono">{Number(t.r_multiple).toFixed(2)}R</span>}
        <span className="text-xs text-ink-faint">{t.time_known ? formatTimeOnly(t.open_time, tz) : ""} · {t.account_name}</span>
        {tags.length > 0 && <span className="ml-auto"><TagChips tags={tags} max={5} /></span>}
      </div>
      <EditableText value={t.notes} placeholder="Write up this trade: why you took it, what you saw, what you'd do again…" rows={4}
        onSave={async (v) => { await api.updateTrade(t.id, { notes: v }); onSaved({ ...t, notes: v }); }} />
      {t.behaviour && <p className="text-xs text-ink-muted mt-2"><span className="text-ink-faint">Behaviour: </span>{t.behaviour}</p>}
      {t.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {t.attachments.map((a, i) => (
            <AnnotatedThumb key={a.id} src={src(a.file_path)} shapes={a.annotations} className="h-40 w-auto rounded-lg border border-card-border cursor-zoom-in"
              title="Open (you can draw on it)" onClick={() => setViewer(i)} />
          ))}
        </div>
      )}
      {viewer !== null && t.attachments[viewer] && (
        <Lightbox images={t.attachments.map((a) => ({ src: src(a.file_path), name: a.original_name, id: a.id, annotations: a.annotations }))}
          index={viewer} onIndex={setViewer} onClose={() => setViewer(null)}
          onAnnotationsSaved={(id: number, shapes: Shape[]) =>
            onSaved({ ...t, attachments: t.attachments.map((a) => (a.id === id ? { ...a, annotations: shapes } : a)) })} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h3 className="text-xs uppercase tracking-wider text-ink-faint font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}

/** A textarea that grows with its text (also prints in full). */
function AutoText({ value, onChange, placeholder, big, cell }: {
  value: string; onChange: (v: string) => void; placeholder?: string; big?: boolean; cell?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      className={cell ? "cell resize-none overflow-hidden" : `input resize-none overflow-hidden ${big ? "text-base font-medium" : "text-sm"}`} />
  );
}
