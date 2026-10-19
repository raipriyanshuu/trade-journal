import { useMemo, useState } from "react";
import { api, Leg, ManualTradePayload } from "../../lib/api";
import { useReference } from "../../lib/useReference";
import { localInputToUtcIso } from "../../lib/format";
import Modal from "../Modal";

interface Props {
  onClose: () => void;
  onCreated: (tradeId: number) => void;
}

interface LegRow {
  time: string; // datetime-local
  price: string;
  quantity: string;
}

function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

const SCENARIOS = ["none", "A", "B", "C"];
const VWAP = ["n/a", "with", "against"];
const ENTRY_LOC = ["other", "at_level", "mid_range", "breakout"];

export default function ManualTradeForm({ onClose, onCreated }: Props) {
  const { accounts, instruments, tags } = useReference();
  const [accountId, setAccountId] = useState<number | "">("");
  const [instrumentId, setInstrumentId] = useState<number | "">("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entries, setEntries] = useState<LegRow[]>([{ time: nowLocalInput(), price: "", quantity: "1" }]);
  const [exits, setExits] = useState<LegRow[]>([{ time: nowLocalInput(), price: "", quantity: "1" }]);
  const [fees, setFees] = useState("0");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [plannedRisk, setPlannedRisk] = useState("");
  const [scenario, setScenario] = useState("none");
  const [planned, setPlanned] = useState<"" | "yes" | "no">("");
  const [checklist, setChecklist] = useState<string>("");
  const [vwap, setVwap] = useState("n/a");
  const [entryLoc, setEntryLoc] = useState("other");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState<string>("");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const instrument = instruments.find((i) => i.id === instrumentId);

  // Live risk / R preview (matches the TradeZella TP/SL panel).
  const preview = useMemo(() => {
    if (!instrument) return null;
    const pv = Number(instrument.point_value);
    const entryPrice = Number(entries[0]?.price);
    const qty = entries.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
    if (!entryPrice || !qty) return null;
    let risk: number | null = null;
    if (plannedRisk) risk = Math.abs(Number(plannedRisk));
    else if (stop) risk = Math.abs(entryPrice - Number(stop)) * qty * pv;
    const reward = target ? Math.abs(Number(target) - entryPrice) * qty * pv : null;
    const plannedR = risk && reward ? reward / risk : null;
    return { risk, reward, plannedR };
  }, [instrument, entries, stop, target, plannedRisk]);

  function updateLeg(which: "entry" | "exit", idx: number, field: keyof LegRow, value: string) {
    const setter = which === "entry" ? setEntries : setExits;
    setter((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function addLeg(which: "entry" | "exit") {
    const setter = which === "entry" ? setEntries : setExits;
    setter((rows) => [...rows, { time: nowLocalInput(), price: "", quantity: "1" }]);
  }
  function removeLeg(which: "entry" | "exit", idx: number) {
    const setter = which === "entry" ? setEntries : setExits;
    setter((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));
  }

  function toLegs(rows: LegRow[]): Leg[] {
    return rows
      .filter((r) => r.price && r.quantity)
      .map((r) => ({
        time: localInputToUtcIso(r.time),
        price: r.price,
        quantity: r.quantity,
      }));
  }

  async function submit() {
    setErr(null);
    if (!accountId || !instrumentId) {
      setErr("Pick an account and instrument.");
      return;
    }
    const entryLegs = toLegs(entries);
    if (entryLegs.length === 0) {
      setErr("At least one entry with price and quantity is required.");
      return;
    }
    const payload: ManualTradePayload = {
      account_id: Number(accountId),
      instrument_id: Number(instrumentId),
      direction,
      entries: entryLegs,
      exits: toLegs(exits),
      fees: fees || "0",
      initial_stop: stop || null,
      planned_target: target || null,
      planned_risk_amount: plannedRisk || null,
      scenario,
      planned: planned === "" ? null : planned === "yes",
      checklist_score: checklist === "" ? null : Number(checklist),
      vwap_relation: vwap,
      entry_location: entryLoc,
      notes,
      self_rating: rating === "" ? null : Number(rating),
      tag_ids: tagIds,
    };
    setSaving(true);
    try {
      const trade = await api.createManualTrade(payload);
      onCreated(trade.id);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  const ccy = instrument?.currency ?? "";

  return (
    <Modal
      title="New trade"
      open
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save trade"}
          </button>
        </>
      }
    >
      {err && <p className="text-neg text-sm mb-3">{err}</p>}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="label">Account</label>
          <select className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            <option value="">Select&hellip;</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Instrument</label>
          <select className="input" value={instrumentId} onChange={(e) => setInstrumentId(Number(e.target.value))}>
            <option value="">Select&hellip;</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol_root}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Direction</label>
          <div className="flex gap-1">
            <button
              className={`btn flex-1 ${direction === "long" ? "bg-pos/20 text-pos" : "bg-card-hover text-ink-muted"}`}
              onClick={() => setDirection("long")}
            >
              Long
            </button>
            <button
              className={`btn flex-1 ${direction === "short" ? "bg-neg/20 text-neg" : "bg-card-hover text-ink-muted"}`}
              onClick={() => setDirection("short")}
            >
              Short
            </button>
          </div>
        </div>
      </div>

      <LegSection
        title="Entries"
        rows={entries}
        onAdd={() => addLeg("entry")}
        onRemove={(i) => removeLeg("entry", i)}
        onChange={(i, f, v) => updateLeg("entry", i, f, v)}
      />
      <LegSection
        title="Exits"
        rows={exits}
        onAdd={() => addLeg("exit")}
        onRemove={(i) => removeLeg("exit", i)}
        onChange={(i, f, v) => updateLeg("exit", i, f, v)}
      />

      <div className="grid grid-cols-4 gap-3 mb-4">
        <div>
          <label className="label">Initial stop</label>
          <input className="input font-mono" value={stop} onChange={(e) => setStop(e.target.value)} />
        </div>
        <div>
          <label className="label">Target</label>
          <input className="input font-mono" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label className="label">Planned risk ({ccy})</label>
          <input className="input font-mono" value={plannedRisk} onChange={(e) => setPlannedRisk(e.target.value)} placeholder="optional" />
        </div>
        <div>
          <label className="label">Fees ({ccy})</label>
          <input className="input font-mono" value={fees} onChange={(e) => setFees(e.target.value)} />
        </div>
      </div>

      {preview && (preview.risk || preview.plannedR) && (
        <div className="card bg-bg-soft p-3 mb-4 flex gap-6 text-sm">
          {preview.risk != null && (
            <div>
              <span className="text-ink-faint">Trade risk</span>
              <div className="font-mono text-neg">
                -{preview.risk.toLocaleString(undefined, { maximumFractionDigits: 2 })} {ccy}
              </div>
            </div>
          )}
          {preview.reward != null && (
            <div>
              <span className="text-ink-faint">Target</span>
              <div className="font-mono text-pos">
                {preview.reward.toLocaleString(undefined, { maximumFractionDigits: 2 })} {ccy}
              </div>
            </div>
          )}
          {preview.plannedR != null && (
            <div>
              <span className="text-ink-faint">Planned R</span>
              <div className="font-mono text-accent-soft">{preview.plannedR.toFixed(2)}R</div>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-card-border pt-3 mb-2 text-xs text-ink-faint">
        Context (auction-market framework)
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div>
          <label className="label">Scenario</label>
          <select className="input" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Planned?</label>
          <select className="input" value={planned} onChange={(e) => setPlanned(e.target.value as "" | "yes" | "no")}>
            <option value="">&mdash;</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label className="label">Checklist (0-4)</label>
          <select className="input" value={checklist} onChange={(e) => setChecklist(e.target.value)}>
            <option value="">&mdash;</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Rating (1-5)</label>
          <select className="input" value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">&mdash;</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">VWAP</label>
          <select className="input" value={vwap} onChange={(e) => setVwap(e.target.value)}>
            {VWAP.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-3">
          <label className="label">Entry location</label>
          <select className="input" value={entryLoc} onChange={(e) => setEntryLoc(e.target.value)}>
            {ENTRY_LOC.map((v) => (
              <option key={v} value={v}>
                {v.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="mb-4">
          <label className="label">Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = tagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() =>
                    setTagIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))
                  }
                  className={`badge ${
                    on
                      ? t.category === "mistake"
                        ? "bg-neg/20 text-neg"
                        : "bg-accent/20 text-accent-soft"
                      : "bg-card-hover text-ink-muted"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function LegSection({
  title,
  rows,
  onAdd,
  onRemove,
  onChange,
}: {
  title: string;
  rows: LegRow[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onChange: (i: number, field: keyof LegRow, value: string) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <label className="label mb-0">{title}</label>
        <button className="text-accent-soft text-xs hover:underline" onClick={onAdd}>
          + add {title === "Entries" ? "entry" : "exit"}
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.6fr_1fr_0.8fr_auto] gap-2">
            <input
              type="datetime-local"
              className="input"
              value={r.time}
              onChange={(e) => onChange(i, "time", e.target.value)}
            />
            <input
              className="input font-mono"
              placeholder="price"
              value={r.price}
              onChange={(e) => onChange(i, "price", e.target.value)}
            />
            <input
              className="input font-mono"
              placeholder="qty (lots)"
              value={r.quantity}
              onChange={(e) => onChange(i, "quantity", e.target.value)}
            />
            <button
              className="btn-ghost px-2 text-ink-faint"
              onClick={() => onRemove(i)}
              title="Remove"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
