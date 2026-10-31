import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ExecutionRow, TradeDetail as TradeDetailT } from "../lib/api";
import { useConfig } from "../lib/config";
import { useReference } from "../lib/useReference";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  pnlColor,
  utcIsoToLocalInput,
  localInputToUtcIso,
} from "../lib/format";
import Modal from "../components/Modal";
import Lightbox from "../components/Lightbox";
import ReplayChart from "../components/trades/ReplayChart";
import {
  CATEGORY_LABELS, ChipPicker, GradeBadge, GradePicker, HtfBadge, HtfPicker, JOURNAL_CATEGORIES, ResultBadge,
  StylePicker, TagChips,
} from "../components/journal/Pickers";
import EditableText from "../components/EditableText";
import { PlaybookPicker, usePlaybooks } from "../components/playbooks/shared";

export default function TradeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { tz } = useConfig();
  const [trade, setTrade] = useState<TradeDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editDetails, setEditDetails] = useState(false);
  const [editExec, setEditExec] = useState<ExecutionRow | null>(null);
  const [viewer, setViewer] = useState<number | null>(null); // open screenshot index

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api
      .getTrade(Number(id))
      .then(setTrade)
      .then(() => setErr(null))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  // Paste a screenshot anywhere on the page.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      if (!trade) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      await api.uploadAttachment(trade.id, blob, "paste.png");
      load();
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [trade, load]);

  if (loading) return <p className="text-ink-muted text-sm">Loading&hellip;</p>;
  if (err) return <p className="text-neg text-sm">{err}</p>;
  if (!trade) return null;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !trade) return;
    await api.uploadAttachment(trade.id, file, file.name);
    load();
  }

  async function removeAttachment(attId: number) {
    if (!confirm("Delete this screenshot? This can't be undone.")) return;
    await api.deleteAttachment(attId);
    load();
  }

  // Save one field straight from the page (inline edits), then refresh.
  async function patch(fields: Parameters<typeof api.updateTrade>[1]) {
    const updated = await api.updateTrade(trade!.id, fields);
    setTrade(updated);
  }

  async function deleteTrade() {
    if (!confirm("Delete this trade and its executions?")) return;
    await api.deleteTrade(trade!.id);
    nav("/trades");
  }

  async function deleteExecution(execId: number) {
    if (!confirm("Delete this execution? The trade will be rebuilt.")) return;
    await api.deleteExecution(execId);
    load();
  }

  return (
    <div>
      <button className="text-ink-muted hover:text-ink text-sm mb-3" onClick={() => nav("/trades")}>
        &larr; Back to Trade Log
      </button>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <span className="font-mono">{trade.symbol}</span>
            <span className={trade.direction === "long" ? "text-pos" : "text-neg"}>
              {trade.direction === "long" ? "Long" : "Short"}
            </span>
            <span className="badge bg-card-border text-ink-muted">{trade.status}</span>
            {trade.is_demo && <span className="badge bg-accent/15 text-accent-soft">demo</span>}
          </h1>
          <p className="text-ink-muted text-sm mt-1">
            {trade.account_name} &middot; {formatDateTime(trade.open_time, tz)}
            {trade.close_time ? ` → ${formatDateTime(trade.close_time, tz)}` : ""}
            {!trade.time_known && <span className="badge bg-warn/15 text-warn ml-2">approx time</span>}
          </p>
        </div>
        <div className="text-right">
          {trade.status === "missed" ? (
            <div className="text-2xl font-mono font-semibold text-violet-300">
              {trade.r_multiple ? `~${trade.r_multiple}R left` : "missed"}
            </div>
          ) : trade.pnl_known ? (
            <div className={`text-2xl font-mono font-semibold ${pnlColor(trade.net_pnl)}`}>
              {formatMoney(trade.net_pnl, trade.currency)}
            </div>
          ) : (
            <div className="text-sm text-ink-faint">P&amp;L not recorded (label only)</div>
          )}
          <div className="text-sm text-ink-muted mt-1 flex items-center gap-2 justify-end">
            {trade.status !== "missed" && <span>{trade.r_multiple ? `${trade.r_multiple}R` : "no R"}</span>}
            <ResultBadge result={trade.result} partial={trade.partial_profit} />
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Avg entry" value={trade.avg_entry ?? "—"} mono />
        <Kpi label="Avg exit" value={trade.avg_exit ?? "—"} mono />
        <Kpi label="Points" value={trade.points ?? "—"} mono />
        <Kpi label="Max size" value={trade.max_position_size} mono />
        <Kpi label="Gross P&L" value={formatMoney(trade.gross_pnl, trade.currency)} mono />
        <Kpi label="Fees" value={formatMoney(trade.fees, trade.currency)} mono />
        <Kpi label="Holding" value={formatDuration(trade.holding_time_seconds)} />
        <Kpi label="Initial stop" value={trade.initial_stop ?? "—"} mono />
        <Kpi label="Target" value={trade.planned_target ?? "—"} mono />
        <Kpi label="Planned risk" value={trade.planned_risk_amount ? formatMoney(trade.planned_risk_amount, trade.currency) : "—"} mono />
        <Kpi label="R multiple" value={trade.r_multiple ? `${trade.r_multiple}R` : "—"} mono />
        <Kpi label="Rating" value={trade.self_rating ? `${trade.self_rating}/5` : "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: executions */}
        <div className="lg:col-span-2 space-y-4">
          <Section title="Replay">
            <ReplayChart tradeId={trade.id} />
          </Section>

          <Section title="Executions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint border-b border-card-border">
                  <th className="px-2 py-1.5 font-medium">Side</th>
                  <th className="px-2 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-2 py-1.5 font-medium text-right">Price</th>
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium text-right">Fees</th>
                  <th className="px-2 py-1.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {trade.executions.map((ex) => (
                  <tr key={ex.id} className="border-b border-card-border/40">
                    <td className={`px-2 py-1.5 ${ex.side === "buy" ? "text-pos" : "text-neg"}`}>{ex.side}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{ex.quantity}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{ex.price}</td>
                    <td className="px-2 py-1.5 text-ink-muted">{formatDateTime(ex.timestamp, tz)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{ex.fees}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button className="btn-ghost px-2 py-0.5 text-xs mr-1" onClick={() => setEditExec(ex)}>Edit</button>
                      <button className="btn-ghost px-2 py-0.5 text-xs text-neg" onClick={() => deleteExecution(ex.id)}>Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Screenshots" action={
            <label className="btn-ghost text-xs cursor-pointer">
              Upload
              <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
            </label>
          }>
            <p className="text-xs text-ink-faint mb-2">Tip: copy an image and paste (Ctrl+V) anywhere on this page.</p>
            <div className="flex flex-wrap gap-2">
              {trade.attachments.length === 0 && <span className="text-ink-faint text-sm">None yet.</span>}
              {trade.attachments.map((a, i) => (
                <div key={a.id} className="relative group">
                  <img
                    src={`/attachments/${a.file_path}`}
                    alt={a.original_name ?? "Screenshot"}
                    title="Click to enlarge"
                    className="h-28 rounded-lg border border-card-border cursor-zoom-in hover:border-accent/60 transition-colors"
                    onClick={() => setViewer(i)}
                  />
                  <button
                    className="absolute top-1 right-1 bg-black/70 text-white rounded px-1.5 text-xs opacity-0 group-hover:opacity-100"
                    title="Delete screenshot"
                    onClick={(e) => { e.stopPropagation(); removeAttachment(a.id); }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Right: context + notes */}
        <div className="space-y-4">
          <Section title="Journal" action={
            <button className="btn-ghost text-xs" onClick={() => setEditDetails(true)}>Edit</button>
          }>
            <div className="mb-3">
              <StylePicker value={trade.style} onChange={(v) => patch({ style: v ?? "" })} />
            </div>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between items-center"><dt className="text-ink-faint">HTF</dt><dd><HtfBadge value={trade.htf_alignment} /></dd></div>
              <div className="flex justify-between items-center"><dt className="text-ink-faint">Entry / exit</dt><dd className="flex gap-1"><GradeBadge grade={trade.entry_quality} /><GradeBadge grade={trade.exit_quality} /></dd></div>
              <Row k="DTR / ATR" v={trade.dtr && trade.atr ? `${Number(trade.dtr)} / ${Number(trade.atr)} (${Math.round((Number(trade.dtr) / Number(trade.atr)) * 100)}%)` : "—"} />
              <Row k="Scenario" v={trade.scenario} />
              <Row k="Planned" v={trade.planned === null ? "—" : trade.planned ? "yes" : "no"} />
            </dl>
            <div className="space-y-2 mt-3">
              {[...JOURNAL_CATEGORIES, "emotion"].map((c) => (
                trade.tags.some((t) => t.category === c) && (
                  <div key={c}>
                    <div className="text-[11px] text-ink-faint mb-0.5">{CATEGORY_LABELS[c]}</div>
                    <TagChips tags={trade.tags} category={c} max={8} />
                  </div>
                )
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <EditableText label="Context" value={trade.context} placeholder="What was the market doing? Click to add…"
                onSave={(v) => patch({ context: v })} />
              <EditableText label="Behaviour" value={trade.behaviour} placeholder="How did you act and feel? Click to add…"
                onSave={(v) => patch({ behaviour: v })} />
            </div>
          </Section>

          <PlaybookSection trade={trade} onSaved={setTrade} />

          <FlagsSection tradeId={trade.id} />

          <Section title="Notes">
            <EditableText value={trade.notes} placeholder="No notes yet. Click to add…" rows={6}
              onSave={(v) => patch({ notes: v })} />
          </Section>

          <button className="btn-danger w-full" onClick={deleteTrade}>Delete trade</button>
        </div>
      </div>

      {editDetails && (
        <TradeEditModal trade={trade} onClose={() => setEditDetails(false)} onSaved={() => { setEditDetails(false); load(); }} />
      )}
      {viewer !== null && trade.attachments[viewer] && (
        <Lightbox
          images={trade.attachments.map((a) => ({ src: `/attachments/${a.file_path}`, name: a.original_name }))}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
      {editExec && (
        <ExecutionEditModal exec={editExec} tz={tz} onClose={() => setEditExec(null)} onSaved={() => { setEditExec(null); load(); }} />
      )}
    </div>
  );
}

/** Which playbook this trade belongs to and the rules followed; saved as you tick. */
function PlaybookSection({ trade, onSaved }: { trade: TradeDetailT; onSaved: (t: TradeDetailT) => void }) {
  const { playbooks } = usePlaybooks();
  const [pid, setPid] = useState<number | null>(trade.playbook?.id ?? null);
  const [ids, setIds] = useState<number[]>(trade.checked_rule_ids ?? []);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPid(trade.playbook?.id ?? null); setIds(trade.checked_rule_ids ?? []); }, [trade.id]);

  // Saves run one at a time; ticks made meanwhile are sent next, so the
  // latest state always wins even when you tick quickly.
  const inflight = useRef(false);
  const pending = useRef<{ pid: number | null; ids: number[] } | null>(null);

  async function change(nextPid: number | null, nextIds: number[]) {
    setPid(nextPid);
    setIds(nextIds);
    setErr(null);
    if (inflight.current) {
      pending.current = { pid: nextPid, ids: nextIds };
      return;
    }
    inflight.current = true;
    let job: { pid: number | null; ids: number[] } | null = { pid: nextPid, ids: nextIds };
    let saved: TradeDetailT | null = null;
    while (job) {
      try {
        saved = await api.setTradePlaybook(trade.id, job.pid, job.ids);
      } catch (e) {
        setErr((e as Error).message.replace(/^\d+:\s*/, ""));
        saved = await api.getTrade(trade.id).catch(() => null); // show what was actually stored
        if (saved) { setPid(saved.playbook?.id ?? null); setIds(saved.checked_rule_ids ?? []); }
        pending.current = null;
      }
      job = pending.current;
      pending.current = null;
    }
    inflight.current = false;
    if (saved) onSaved(saved);
  }

  return (
    <Section title="Playbook" action={pid ? <a className="text-xs text-accent-soft hover:underline" href={`/playbooks/${pid}`}>Open</a> : undefined}>
      {playbooks.filter((p) => !p.archived).length === 0 && !pid ? (
        <p className="text-sm text-ink-faint">No playbooks yet. <a className="text-accent-soft hover:underline" href="/playbooks">Create one</a> to track which rules you follow.</p>
      ) : (
        <PlaybookPicker playbooks={playbooks} playbookId={pid} checked={ids} onChange={change} />
      )}
      {err && <p className="text-xs text-neg mt-1">{err}</p>}
    </Section>
  );
}

function FlagsSection({ tradeId }: { tradeId: number }) {
  const [flags, setFlags] = useState<Awaited<ReturnType<typeof api.listFlags>>>([]);
  const [adding, setAdding] = useState("");

  const reload = useCallback(() => { api.listFlags(tradeId).then(setFlags); }, [tradeId]);
  useEffect(reload, [reload]);

  async function addManual() {
    if (!adding.trim()) return;
    await api.addFlag(tradeId, adding.trim(), "manual flag");
    setAdding("");
    reload();
  }

  return (
    <Section title="Mistake flags">
      {flags.length === 0 && <p className="text-ink-faint text-sm mb-2">No flags.</p>}
      <div className="space-y-1.5 mb-2">
        {flags.map((f) => (
          <div key={f.id} className={`flex items-center gap-2 text-sm ${f.dismissed ? "opacity-50" : ""}`}>
            <span className={`badge ${f.source === "auto" ? "bg-warn/15 text-warn" : "bg-neg/15 text-neg"}`}>{f.source}</span>
            <span className="font-mono text-xs flex-1" title={f.explanation}>{f.rule_code}</span>
            <button className="text-xs text-ink-faint hover:text-ink" onClick={() => api.dismissFlag(f.id, !f.dismissed).then(reload)}>
              {f.dismissed ? "restore" : "dismiss"}
            </button>
            {f.source === "manual" && (
              <button className="text-xs text-ink-faint hover:text-neg" onClick={() => api.deleteFlag(f.id).then(reload)}>&times;</button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        <input className="input !py-1 text-xs" placeholder="add manual flag (e.g. CHASED)" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addManual()} />
        <button className="btn-ghost !py-1 text-xs" onClick={addManual}>Add</button>
      </div>
    </Section>
  );
}

function Kpi({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-sm mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-faint">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function TradeEditModal({ trade, onClose, onSaved }: { trade: TradeDetailT; onClose: () => void; onSaved: () => void }) {
  const { tags } = useReference();
  const [stop, setStop] = useState(trade.initial_stop ?? "");
  const [target, setTarget] = useState(trade.planned_target ?? "");
  const [risk, setRisk] = useState(trade.planned_risk_amount ?? "");
  const [scenario, setScenario] = useState(trade.scenario);
  const [planned, setPlanned] = useState(trade.planned === null ? "" : trade.planned ? "yes" : "no");
  const [checklist, setChecklist] = useState(trade.checklist_score === null ? "" : String(trade.checklist_score));
  const [vwap, setVwap] = useState(trade.vwap_relation);
  const [entryLoc, setEntryLoc] = useState(trade.entry_location);
  const [rating, setRating] = useState(trade.self_rating === null ? "" : String(trade.self_rating));
  const [pnlOnly, setPnlOnly] = useState(trade.pnl_only);
  const [notes, setNotes] = useState(trade.notes);
  const [tagIds, setTagIds] = useState<number[]>(trade.tags.map((t) => t.id));
  const [dtr, setDtr] = useState(trade.dtr ?? "");
  const [atr, setAtr] = useState(trade.atr ?? "");
  const [entryQ, setEntryQ] = useState<string | null>(trade.entry_quality);
  const [exitQ, setExitQ] = useState<string | null>(trade.exit_quality);
  const [htf, setHtf] = useState<string | null>(trade.htf_alignment);
  const [context, setContext] = useState(trade.context);
  const [behaviour, setBehaviour] = useState(trade.behaviour);
  const [partial, setPartial] = useState(trade.partial_profit);
  const [style, setStyle] = useState<string | null>(trade.style);
  const [saving, setSaving] = useState(false);
  const toggleTag = (id: number) => setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function save() {
    setSaving(true);
    try {
      await api.updateTrade(trade.id, {
        dtr: dtr || null,
        atr: atr || null,
        entry_quality: entryQ,
        exit_quality: exitQ,
        htf_alignment: htf,
        context,
        behaviour,
        partial_profit: partial,
        style: style ?? "",
        initial_stop: stop || null,
        planned_target: target || null,
        planned_risk_amount: risk || null,
        scenario,
        planned: planned === "" ? null : planned === "yes",
        checklist_score: checklist === "" ? null : Number(checklist),
        vwap_relation: vwap,
        entry_location: entryLoc,
        self_rating: rating === "" ? null : Number(rating),
        pnl_only: pnlOnly,
        notes,
        tag_ids: tagIds,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal wide title="Edit trade" open onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </>
    }>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <HtfPicker value={htf} onChange={setHtf} />
        <GradePicker label="Entry quality" value={entryQ} onChange={setEntryQ} />
        <GradePicker label="Exit quality" value={exitQ} onChange={setExitQ} />
        <div><label className="label">DTR</label><input className="input font-mono" value={dtr} onChange={(e) => setDtr(e.target.value)} /></div>
        <div><label className="label">ATR</label><input className="input font-mono" value={atr} onChange={(e) => setAtr(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm pt-5">
          <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Took partial profit
        </label>
      </div>
      <div className="space-y-3 mb-4">
        <StylePicker value={style} onChange={setStyle} />
        {JOURNAL_CATEGORIES.map((c) => <ChipPicker key={c} tags={tags} category={c} selected={tagIds} onToggle={toggleTag} />)}
        <ChipPicker tags={tags} category="emotion" selected={tagIds} onToggle={toggleTag} />
        <ChipPicker tags={tags} category="custom" selected={tagIds} onToggle={toggleTag} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className="label">Context</label><textarea className="input min-h-[60px]" value={context} onChange={(e) => setContext(e.target.value)} /></div>
          <div><label className="label">Behaviour</label><textarea className="input min-h-[60px]" value={behaviour} onChange={(e) => setBehaviour(e.target.value)} /></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="label">Initial stop</label><input className="input font-mono" value={stop} onChange={(e) => setStop(e.target.value)} /></div>
        <div><label className="label">Target</label><input className="input font-mono" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div><label className="label">Planned risk</label><input className="input font-mono" value={risk} onChange={(e) => setRisk(e.target.value)} /></div>
        <div><label className="label">Scenario</label>
          <select className="input" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {["none", "A", "B", "C"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><label className="label">Planned?</label>
          <select className="input" value={planned} onChange={(e) => setPlanned(e.target.value)}>
            <option value="">&mdash;</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </div>
        <div><label className="label">Checklist</label>
          <select className="input" value={checklist} onChange={(e) => setChecklist(e.target.value)}>
            <option value="">&mdash;</option>{[0,1,2,3,4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div><label className="label">VWAP</label>
          <select className="input" value={vwap} onChange={(e) => setVwap(e.target.value)}>
            {["n/a","with","against"].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div><label className="label">Entry loc</label>
          <select className="input" value={entryLoc} onChange={(e) => setEntryLoc(e.target.value)}>
            {["other","at_level","mid_range","breakout"].map((v) => <option key={v} value={v}>{v.replace("_"," ")}</option>)}
          </select>
        </div>
        <div><label className="label">Rating</label>
          <select className="input" value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">&mdash;</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm mt-3">
        <input type="checkbox" checked={pnlOnly} onChange={(e) => setPnlOnly(e.target.checked)} />
        P&amp;L-only trade (exclude from point &amp; R stats)
      </label>
      <div className="mt-3">
        <label className="label">Notes</label>
        <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function ExecutionEditModal({ exec, tz, onClose, onSaved }: { exec: ExecutionRow; tz: string; onClose: () => void; onSaved: () => void }) {
  const [side, setSide] = useState(exec.side);
  const [qty, setQty] = useState(exec.quantity);
  const [price, setPrice] = useState(exec.price);
  const [fees, setFees] = useState(exec.fees);
  const [time, setTime] = useState(utcIsoToLocalInput(exec.timestamp, tz));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateExecution(exec.id, {
        side,
        quantity: qty,
        price,
        fees,
        timestamp: localInputToUtcIso(time),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit execution" open onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </>
    }>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Side</label>
          <select className="input" value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="buy">buy</option><option value="sell">sell</option>
          </select>
        </div>
        <div><label className="label">Quantity (lots)</label><input className="input font-mono" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><label className="label">Price</label><input className="input font-mono" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="label">Fees</label><input className="input font-mono" value={fees} onChange={(e) => setFees(e.target.value)} /></div>
        <div className="col-span-2"><label className="label">Time</label><input type="datetime-local" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
