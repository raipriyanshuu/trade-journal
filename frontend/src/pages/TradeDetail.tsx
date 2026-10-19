import { useCallback, useEffect, useState } from "react";
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

export default function TradeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { tz } = useConfig();
  const [trade, setTrade] = useState<TradeDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editDetails, setEditDetails] = useState(false);
  const [editExec, setEditExec] = useState<ExecutionRow | null>(null);

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
    await api.deleteAttachment(attId);
    load();
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
          <div className={`text-2xl font-mono font-semibold ${pnlColor(trade.net_pnl)}`}>
            {formatMoney(trade.net_pnl, trade.currency)}
          </div>
          <div className="text-sm text-ink-muted">
            {trade.r_multiple ? `${trade.r_multiple}R` : "no R"} &middot; {trade.result}
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
              {trade.attachments.map((a) => (
                <div key={a.id} className="relative group">
                  <img src={`/attachments/${a.file_path}`} className="h-28 rounded-lg border border-card-border" />
                  <button
                    className="absolute top-1 right-1 bg-black/70 text-white rounded px-1.5 text-xs opacity-0 group-hover:opacity-100"
                    onClick={() => removeAttachment(a.id)}
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
          <Section title="Context" action={
            <button className="btn-ghost text-xs" onClick={() => setEditDetails(true)}>Edit</button>
          }>
            <dl className="text-sm space-y-1.5">
              <Row k="Scenario" v={trade.scenario} />
              <Row k="Planned" v={trade.planned === null ? "—" : trade.planned ? "yes" : "no"} />
              <Row k="Checklist" v={trade.checklist_score === null ? "—" : `${trade.checklist_score}/4`} />
              <Row k="VWAP" v={trade.vwap_relation} />
              <Row k="Entry loc" v={trade.entry_location.replace("_", " ")} />
            </dl>
            {trade.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {trade.tags.map((t) => (
                  <span key={t.id} className={`badge ${t.category === "mistake" ? "bg-neg/15 text-neg" : "bg-accent/15 text-accent-soft"}`}>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <FlagsSection tradeId={trade.id} />

          <Section title="Notes">
            <p className="text-sm text-ink-muted whitespace-pre-wrap">{trade.notes || "No notes."}</p>
          </Section>

          <button className="btn-danger w-full" onClick={deleteTrade}>Delete trade</button>
        </div>
      </div>

      {editDetails && (
        <TradeEditModal trade={trade} onClose={() => setEditDetails(false)} onSaved={() => { setEditDetails(false); load(); }} />
      )}
      {editExec && (
        <ExecutionEditModal exec={editExec} tz={tz} onClose={() => setEditExec(null)} onSaved={() => { setEditExec(null); load(); }} />
      )}
    </div>
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
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateTrade(trade.id, {
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
    <Modal title="Edit trade" open onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </>
    }>
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
      {tags.length > 0 && (
        <div className="mt-3">
          <label className="label">Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = tagIds.includes(t.id);
              return (
                <button key={t.id}
                  onClick={() => setTagIds((ids) => on ? ids.filter((x) => x !== t.id) : [...ids, t.id])}
                  className={`badge ${on ? (t.category === "mistake" ? "bg-neg/20 text-neg" : "bg-accent/20 text-accent-soft") : "bg-card-hover text-ink-muted"}`}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
