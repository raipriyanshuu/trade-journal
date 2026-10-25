import { useMemo, useState } from "react";
import { api, Leg, ManualTradePayload, MissedTradePayload } from "../../lib/api";
import { useReference } from "../../lib/useReference";
import { localInputToUtcIso } from "../../lib/format";
import Modal from "../Modal";
import { ChipPicker, GradePicker, HtfPicker, StylePicker } from "../journal/Pickers";
import { lastStyleFor, rememberStyle } from "../../lib/useStyles";

interface Props {
  onClose: () => void;
  onCreated: (tradeId: number) => void;
  defaultAccountId?: number | null;
  defaultDate?: string; // YYYY-MM-DD (trading day being journaled)
  initialMode?: "taken" | "missed";
}

interface LegRow {
  time: string; // datetime-local
  price: string;
  quantity: string;
}

function localInput(date?: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = date ?? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SCENARIOS = ["none", "A", "B", "C"];

export default function ManualTradeForm({ onClose, onCreated, defaultAccountId, defaultDate, initialMode = "taken" }: Props) {
  const { accounts, instruments, tags } = useReference();
  const [mode, setMode] = useState<"taken" | "missed">(initialMode);
  const [accountId, setAccountId] = useState<number | "">(defaultAccountId ?? "");
  const [instrumentId, setInstrumentId] = useState<number | "">("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entries, setEntries] = useState<LegRow[]>([{ time: localInput(defaultDate), price: "", quantity: "1" }]);
  const [exits, setExits] = useState<LegRow[]>([{ time: localInput(defaultDate), price: "", quantity: "1" }]);
  const [missedTime, setMissedTime] = useState(localInput(defaultDate));
  const [missedQty, setMissedQty] = useState("1");
  const [plannedEntry, setPlannedEntry] = useState("");
  const [fees, setFees] = useState("0");
  const [chargesNote, setChargesNote] = useState<string | null>(null);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [plannedRisk, setPlannedRisk] = useState("");
  const [dtr, setDtr] = useState("");
  const [atr, setAtr] = useState("");
  const [htf, setHtf] = useState<string | null>(null);
  const [entryQ, setEntryQ] = useState<string | null>(null);
  const [exitQ, setExitQ] = useState<string | null>(null);
  const [scenario, setScenario] = useState("none");
  const [planned, setPlanned] = useState<"" | "yes" | "no">("");
  const [context, setContext] = useState("");
  const [behaviour, setBehaviour] = useState("");
  const [partial, setPartial] = useState(false);
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState<string>("");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [styleTouched, setStyleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const instrument = instruments.find((i) => i.id === instrumentId);
  const ccy = instrument?.currency ?? "";
  const ccyLabel = ccy ? ` (${ccy})` : "";
  const missed = mode === "missed";

  const preview = useMemo(() => {
    if (!instrument) return null;
    const pv = Number(instrument.point_value);
    const entryPrice = Number(missed ? plannedEntry : entries[0]?.price);
    const qty = missed ? Number(missedQty) || 0 : entries.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
    if (!entryPrice || !qty) return null;
    let risk: number | null = null;
    if (plannedRisk) risk = Math.abs(Number(plannedRisk));
    else if (stop) risk = Math.abs(entryPrice - Number(stop)) * qty * pv;
    const reward = target ? Math.abs(Number(target) - entryPrice) * qty * pv : null;
    const plannedR = risk && reward ? reward / risk : null;
    return { risk, reward, plannedR };
  }, [instrument, entries, stop, target, plannedRisk, missed, plannedEntry, missedQty]);

  const atrUsed = dtr && atr && Number(atr) ? Math.round((Number(dtr) / Number(atr)) * 100) : null;

  // Pre-fill the style you last used on this instrument (unless you already chose one).
  function pickInstrument(id: number) {
    setInstrumentId(id);
    if (!styleTouched) setStyle(lastStyleFor(id));
  }
  function chooseStyle(v: string | null) {
    setStyle(v);
    setStyleTouched(true);
  }

  function toggleTag(id: number) {
    setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  function updateLeg(which: "entry" | "exit", idx: number, field: keyof LegRow, value: string) {
    const setter = which === "entry" ? setEntries : setExits;
    setter((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function addLeg(which: "entry" | "exit") {
    const setter = which === "entry" ? setEntries : setExits;
    setter((rows) => [...rows, { time: localInput(defaultDate), price: "", quantity: "1" }]);
  }
  function removeLeg(which: "entry" | "exit", idx: number) {
    const setter = which === "entry" ? setEntries : setExits;
    setter((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));
  }
  function toLegs(rows: LegRow[]): Leg[] {
    return rows.filter((r) => r.price && r.quantity)
      .map((r) => ({ time: localInputToUtcIso(r.time), price: r.price, quantity: r.quantity }));
  }

  async function autoCharges() {
    if (!instrument) return;
    try {
      const res = await api.estimateCharges({
        instrument_id: instrument.id, direction,
        entries: entries.filter((r) => r.price).map((r) => ({ price: r.price, quantity: r.quantity })),
        exits: exits.filter((r) => r.price).map((r) => ({ price: r.price, quantity: r.quantity })),
      });
      setFees(String(res.total));
      setChargesNote(`${res.exchange_name} charges: brokerage ${res.brokerage}, STT/CTT ${res.stt_ctt}, exchange ${res.exchange}, GST ${res.gst}, stamp ${res.stamp_duty}, SEBI ${res.sebi}${res.verified ? "" : " — rates unverified, check Settings"}`);
    } catch (e) {
      setChargesNote((e as Error).message);
    }
  }

  const journal = {
    dtr: dtr || null, atr: atr || null, entry_quality: entryQ,
    exit_quality: missed ? null : exitQ, htf_alignment: htf,
    context, behaviour, partial_profit: missed ? false : partial, style,
  };

  async function submit() {
    setErr(null);
    if (!accountId || !instrumentId) {
      setErr("Pick an account and instrument.");
      return;
    }
    setSaving(true);
    rememberStyle(Number(instrumentId), style);
    try {
      if (missed) {
        const payload: MissedTradePayload = {
          ...journal, account_id: Number(accountId), instrument_id: Number(instrumentId), direction,
          time: localInputToUtcIso(missedTime), quantity: missedQty || "1",
          planned_entry: plannedEntry || null, initial_stop: stop || null, planned_target: target || null,
          scenario, notes, tag_ids: tagIds,
        };
        const t = await api.createMissedTrade(payload);
        onCreated(t.id);
        return;
      }
      const entryLegs = toLegs(entries);
      if (entryLegs.length === 0) {
        setErr("At least one entry with price and quantity is required.");
        setSaving(false);
        return;
      }
      const payload: ManualTradePayload = {
        ...journal, account_id: Number(accountId), instrument_id: Number(instrumentId), direction,
        entries: entryLegs, exits: toLegs(exits), fees: fees || "0",
        initial_stop: stop || null, planned_target: target || null, planned_risk_amount: plannedRisk || null,
        scenario, planned: planned === "" ? null : planned === "yes",
        notes, self_rating: rating === "" ? null : Number(rating), tag_ids: tagIds,
      };
      const trade = await api.createManualTrade(payload);
      onCreated(trade.id);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal wide title={missed ? "Log a missed setup" : "Log a trade"} open onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : missed ? "Save missed setup" : "Save trade"}
          </button>
        </>
      }>
      {err && <p className="text-neg text-sm mb-3">{err}</p>}

      <div className="flex gap-1 mb-4 p-1 bg-bg-soft rounded-lg w-fit">
        {(["taken", "missed"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${mode === m ? "bg-card text-ink" : "text-ink-muted"}`}>
            {m === "taken" ? "Trade taken" : "Missed setup"}
          </button>
        ))}
      </div>

      {/* 1. The trade */}
      <Section n={1} title="The trade">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="label">Account</label>
            <select className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              <option value="">Select&hellip;</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency}){a.is_demo ? " · demo — not for real trades" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Instrument</label>
            <select className="input" value={instrumentId} onChange={(e) => pickInstrument(Number(e.target.value))}>
              <option value="">Select&hellip;</option>
              {instruments.map((i) => <option key={i.id} value={i.id}>{i.symbol_root}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Direction</label>
            <div className="flex gap-1">
              <button className={`btn flex-1 ${direction === "long" ? "bg-pos/20 text-pos" : "bg-card-hover text-ink-muted"}`} onClick={() => setDirection("long")}>Long</button>
              <button className={`btn flex-1 ${direction === "short" ? "bg-neg/20 text-neg" : "bg-card-hover text-ink-muted"}`} onClick={() => setDirection("short")}>Short</button>
            </div>
          </div>
        </div>

        <div className="mb-3">
          <StylePicker label="Style (scalp, swing...)" value={style} onChange={chooseStyle} />
        </div>

        {missed ? (
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="label">Time you saw it</label>
              <input type="datetime-local" className="input" value={missedTime} onChange={(e) => setMissedTime(e.target.value)} />
            </div>
            <div>
              <label className="label">Lot size</label>
              <input className="input font-mono" value={missedQty} onChange={(e) => setMissedQty(e.target.value)} />
            </div>
            <div>
              <label className="label">Planned entry</label>
              <input className="input font-mono" value={plannedEntry} onChange={(e) => setPlannedEntry(e.target.value)} />
            </div>
          </div>
        ) : (
          <>
            <LegSection title="Entries" rows={entries} onAdd={() => addLeg("entry")} onRemove={(i) => removeLeg("entry", i)} onChange={(i, f, v) => updateLeg("entry", i, f, v)} />
            <LegSection title="Exits" rows={exits} onAdd={() => addLeg("exit")} onRemove={(i) => removeLeg("exit", i)} onChange={(i, f, v) => updateLeg("exit", i, f, v)} />
          </>
        )}

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div><label className="label">Stop</label><input className="input font-mono" value={stop} onChange={(e) => setStop(e.target.value)} /></div>
          <div><label className="label">Target</label><input className="input font-mono" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          {!missed && <div><label className="label">Risk{ccyLabel}</label><input className="input font-mono" value={plannedRisk} onChange={(e) => setPlannedRisk(e.target.value)} placeholder="optional" /></div>}
          {!missed && (
            <div>
              <label className="label flex justify-between">
                <span>Fees{ccyLabel}</span>
                {ccy === "INR" && <button type="button" className="text-accent-soft hover:underline" onClick={autoCharges}>auto</button>}
              </label>
              <input className="input font-mono" value={fees} onChange={(e) => setFees(e.target.value)} />
            </div>
          )}
          <div><label className="label">DTR</label><input className="input font-mono" value={dtr} onChange={(e) => setDtr(e.target.value)} placeholder="day range" /></div>
          <div>
            <label className="label">ATR {atrUsed !== null && <span className="text-accent-soft">&middot; {atrUsed}% used</span>}</label>
            <input className="input font-mono" value={atr} onChange={(e) => setAtr(e.target.value)} />
          </div>
        </div>
        {chargesNote && <p className="text-xs text-ink-faint mt-2">{chargesNote}</p>}

        {preview && (preview.risk || preview.plannedR) && (
          <div className="mt-3 flex gap-6 text-sm bg-bg-soft rounded-lg px-3 py-2">
            {preview.risk != null && <div><span className="text-ink-faint text-xs block">Risk</span><span className="font-mono text-neg">-{preview.risk.toLocaleString(undefined, { maximumFractionDigits: 2 })} {ccy}</span></div>}
            {preview.reward != null && <div><span className="text-ink-faint text-xs block">Reward</span><span className="font-mono text-pos">{preview.reward.toLocaleString(undefined, { maximumFractionDigits: 2 })} {ccy}</span></div>}
            {preview.plannedR != null && <div><span className="text-ink-faint text-xs block">Planned R</span><span className="font-mono text-accent-soft">{preview.plannedR.toFixed(2)}R</span></div>}
          </div>
        )}
      </Section>

      {/* 2. Context */}
      <Section n={2} title="Context (before the trade)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <HtfPicker value={htf} onChange={setHtf} />
          <div>
            <label className="label">Scenario</label>
            <div className="flex gap-1">
              {SCENARIOS.map((s) => (
                <button key={s} type="button" onClick={() => setScenario(s)}
                  className={`btn flex-1 !py-1 text-xs ${scenario === s ? "bg-accent/25 text-ink" : "bg-card-hover text-ink-faint"}`}>
                  {s === "none" ? "—" : s}
                </button>
              ))}
            </div>
          </div>
          {!missed && (
            <div>
              <label className="label">In the plan?</label>
              <div className="flex gap-1">
                {(["yes", "no"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPlanned(planned === p ? "" : p)}
                    className={`btn flex-1 !py-1 text-xs ${planned === p ? (p === "yes" ? "bg-pos/20 text-pos" : "bg-neg/20 text-neg") : "bg-card-hover text-ink-faint"}`}>
                    {p === "yes" ? "Planned" : "Unplanned"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <ChipPicker tags={tags} category="probability" selected={tagIds} onToggle={toggleTag} />
          <ChipPicker tags={tags} category="setup" selected={tagIds} onToggle={toggleTag} />
          <ChipPicker tags={tags} category="location" selected={tagIds} onToggle={toggleTag} />
          <div>
            <label className="label">Context &mdash; what was the market doing?</label>
            <textarea className="input min-h-[56px]" value={context} onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. 7850 put wall, expected a support; overnight inventory short…" />
          </div>
        </div>
      </Section>

      {/* 3. Execution & review */}
      <Section n={3} title={missed ? "Why you missed it" : "Execution & review (after the trade)"}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <GradePicker label={missed ? "Setup quality" : "Entry quality"} value={entryQ} onChange={setEntryQ} />
          {!missed && <GradePicker label="Exit quality" value={exitQ} onChange={setExitQ} />}
          {!missed && (
            <div>
              <label className="label">Rating (1-5)</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(rating === String(n) ? "" : String(n))}
                    className={`btn flex-1 !py-1 text-xs ${rating === String(n) ? "bg-accent/25 text-ink" : "bg-card-hover text-ink-faint"}`}>{n}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <ChipPicker tags={tags} category="thesis" selected={tagIds} onToggle={toggleTag} />
          <ChipPicker tags={tags} category="mistake" selected={tagIds} onToggle={toggleTag} />
          {!missed && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
              Took partial profit
            </label>
          )}
          <div>
            <label className="label">Behaviour &mdash; how did you act and feel?</label>
            <textarea className="input min-h-[56px]" value={behaviour} onChange={(e) => setBehaviour(e.target.value)}
              placeholder="e.g. Entered before the location; got impatient after the first loss…" />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-[44px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </Section>
    </Modal>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 rounded-full bg-accent/25 text-accent-soft text-xs flex items-center justify-center font-semibold">{n}</span>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function LegSection({ title, rows, onAdd, onRemove, onChange }: {
  title: string; rows: LegRow[]; onAdd: () => void; onRemove: (i: number) => void;
  onChange: (i: number, field: keyof LegRow, value: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <label className="label mb-0">{title}</label>
        <button className="text-accent-soft text-xs hover:underline" onClick={onAdd}>+ add {title === "Entries" ? "entry" : "exit"}</button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.6fr_1fr_0.8fr_auto] gap-2">
            <input type="datetime-local" className="input" value={r.time} onChange={(e) => onChange(i, "time", e.target.value)} />
            <input className="input font-mono" placeholder="price" value={r.price} onChange={(e) => onChange(i, "price", e.target.value)} />
            <input className="input font-mono" placeholder="lots" value={r.quantity} onChange={(e) => onChange(i, "quantity", e.target.value)} />
            <button className="btn-ghost px-2 text-ink-faint" onClick={() => onRemove(i)} title="Remove">&times;</button>
          </div>
        ))}
      </div>
    </div>
  );
}
