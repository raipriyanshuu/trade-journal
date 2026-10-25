import { BtSession, Candle, money } from "../../lib/backtestApi";

export interface Draft {
  side: "long" | "short";
  stop: string;
  target: string;
  sizing: "risk" | "qty";
  risk: string;
  qty: string;
  setup: string;
}

export const snap = (p: number, tick: number) => Math.round(Math.round(p / tick) * tick * 1e6) / 1e6;

/** Default stop 1 x average range of the last 14 candles away, target at 2R. */
export function suggestLevels(side: "long" | "short", price: number, candles: Candle[], tick: number) {
  const recent = candles.slice(-14);
  const atr = recent.length ? recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length : price * 0.002;
  const d = Math.max(atr, tick * 4);
  const sign = side === "long" ? 1 : -1;
  return { stop: snap(price - sign * d, tick), target: snap(price + sign * 2 * d, tick) };
}

export function sizeFor(draft: Draft, price: number | null, s: BtSession) {
  const stop = Number(draft.stop);
  const target = Number(draft.target);
  const dist = price !== null && draft.stop !== "" && stop ? Math.abs(price - stop) : null;
  const perContract = dist !== null ? dist * s.point_value : null;
  let qty: number;
  if (draft.sizing === "risk") {
    qty = perContract ? Math.floor(Number(draft.risk || 0) / perContract) : 0;
  } else {
    qty = Math.max(0, Math.floor(Number(draft.qty || 0)));
  }
  const risk = perContract !== null ? perContract * qty : null;
  const reward = price !== null && draft.target !== "" && target ? Math.abs(target - price) * s.point_value * qty : null;
  return { qty, risk, reward, rr: risk && reward ? reward / risk : null, perContract };
}

export default function OrderTicket({ session, price, candles, draft, setDraft, onPlace, busy }: {
  session: BtSession;
  price: number | null;
  candles: Candle[];
  draft: Draft;
  setDraft: (d: Draft) => void;
  onPlace: () => void;
  busy: boolean;
}) {
  const { qty, risk, reward, rr, perContract } = sizeFor(draft, price, session);
  const long = draft.side === "long";

  function pickSide(side: "long" | "short") {
    if (price === null) return setDraft({ ...draft, side });
    const lv = suggestLevels(side, price, candles, session.tick_size);
    setDraft({ ...draft, side, stop: String(lv.stop), target: String(lv.target) });
  }

  const tooSmall = draft.sizing === "risk" && perContract !== null && qty === 0;
  return (
    <div className="card p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Order</h3>
        <span className="text-xs text-ink-faint">market @ {price ?? "—"}</span>
      </div>
      <div className="flex gap-1">
        <button className={`btn flex-1 ${long ? "bg-pos/25 text-pos ring-1 ring-pos/50" : "bg-card-hover text-ink-muted"}`} onClick={() => pickSide("long")}>Long</button>
        <button className={`btn flex-1 ${!long ? "bg-neg/25 text-neg ring-1 ring-neg/50" : "bg-card-hover text-ink-muted"}`} onClick={() => pickSide("short")}>Short</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Stop</label>
          <input className="input font-mono !py-1" value={draft.stop} onChange={(e) => setDraft({ ...draft, stop: e.target.value })} placeholder="none" />
        </div>
        <div>
          <label className="label">Target</label>
          <input className="input font-mono !py-1" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} placeholder="none" />
        </div>
      </div>
      <p className="text-[11px] text-ink-faint -mt-1">Drag the dashed lines on the chart to adjust.</p>
      <div>
        <div className="flex items-center justify-between">
          <label className="label">Size</label>
          <div className="flex text-[11px] bg-bg-soft rounded p-0.5 mb-1">
            {(["risk", "qty"] as const).map((m) => (
              <button key={m} className={`px-2 rounded ${draft.sizing === m ? "bg-card text-ink" : "text-ink-faint"}`}
                onClick={() => setDraft({ ...draft, sizing: m })}>
                {m === "risk" ? "by risk $" : "contracts"}
              </button>
            ))}
          </div>
        </div>
        {draft.sizing === "risk" ? (
          <input className="input font-mono !py-1" value={draft.risk} onChange={(e) => setDraft({ ...draft, risk: e.target.value })} />
        ) : (
          <input className="input font-mono !py-1" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs bg-bg-soft rounded-lg px-2 py-1.5">
        <div><div className="text-ink-faint">Risk</div><div className="font-mono text-neg">{risk !== null ? money(-risk) : "—"}</div></div>
        <div><div className="text-ink-faint">Reward</div><div className="font-mono text-pos">{reward !== null ? money(reward) : "—"}</div></div>
        <div><div className="text-ink-faint">R:R</div><div className="font-mono">{rr !== null ? rr.toFixed(2) : "—"}</div></div>
      </div>
      {tooSmall && <p className="text-xs text-warn">Risk is too small for 1 {session.contract_label} at this stop.</p>}
      <input className="input !py-1 text-sm" list="bt-setups" placeholder="Setup (e.g. ORB, VWAP reclaim)" value={draft.setup}
        onChange={(e) => setDraft({ ...draft, setup: e.target.value })} />
      <button
        className={`btn w-full !py-2 font-semibold ${long ? "bg-pos text-white hover:bg-pos/90" : "bg-neg text-white hover:bg-neg/90"}`}
        disabled={busy || qty <= 0 || price === null}
        onClick={onPlace}
      >
        {long ? "BUY" : "SELL"} {qty || ""} {session.contract_label} @ {price ?? "—"}
      </button>
    </div>
  );
}
