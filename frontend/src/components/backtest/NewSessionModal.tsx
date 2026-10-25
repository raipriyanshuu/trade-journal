import { useEffect, useState } from "react";
import Modal from "../Modal";
import { bt, BtInstrument, BtSession, TIMEFRAMES } from "../../lib/backtestApi";

function isoDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

/** New backtest session: a strategy on one instrument from a start date. */
export default function NewSessionModal({ instruments, strategies, onClose, onCreated, onOpenData }: {
  instruments: BtInstrument[];
  strategies: string[];
  onClose: () => void;
  onCreated: (s: BtSession) => void;
  onOpenData: () => void;
}) {
  const [strategy, setStrategy] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("CL");
  const [contract, setContract] = useState<"full" | "micro">("micro");
  const [balance, setBalance] = useState("10000");
  const [risk, setRisk] = useState("100");
  const [fee, setFee] = useState("");
  const [tf, setTf] = useState("1h");
  const [start, setStart] = useState(isoDaysAgo(180));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inst = instruments.find((i) => i.symbol === symbol);
  const cov = inst?.coverage ?? {};
  const hasData = Object.keys(cov).length > 0;

  useEffect(() => {
    if (inst) setFee(String(contract === "micro" ? inst.fee_micro : inst.fee_full));
  }, [symbol, contract, inst?.symbol]);

  async function create() {
    setErr(null);
    if (!strategy.trim()) return setErr("Give the strategy a name — the dashboard compares strategies.");
    setBusy(true);
    try {
      const s = await bt.createSession({
        strategy, name, symbol, contract, timeframe: tf, start_date: start,
        starting_balance: Number(balance) || 0, risk_per_trade: Number(risk) || 0,
        fee_per_contract: fee === "" ? null : Number(fee),
      });
      onCreated(s);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");
  return (
    <Modal title="New backtest session" open onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Start replay"}</button>
      </>
    }>
      {err && <p className="text-neg text-sm mb-3">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Strategy</label>
          <input className="input" list="bt-strategies" value={strategy} onChange={(e) => setStrategy(e.target.value)}
            placeholder="e.g. Crude swing – breakout retest" autoFocus />
          <datalist id="bt-strategies">{strategies.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="col-span-2">
          <label className="label">Session name (optional)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="defaults to strategy – contract" />
        </div>
        <div>
          <label className="label">Instrument</label>
          <select className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {instruments.map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol} — {i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Contract</label>
          <div className="flex gap-1">
            {(["full", "micro"] as const).map((c) => (
              <button key={c} className={`btn flex-1 !py-1.5 text-xs ${contract === c ? "bg-accent/25 text-ink" : "bg-card-hover text-ink-faint"}`}
                onClick={() => setContract(c)}>
                {c === "full" ? `${symbol} ($${inst?.point_value}/pt)` : `${inst?.micro} ($${inst?.micro_point_value}/pt)`}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2 text-xs rounded-lg bg-bg-soft px-3 py-2">
          {hasData ? (
            <div className="grid grid-cols-3 gap-2 text-ink-muted">
              <span>5m: {day(cov["5m"]?.first)} →</span>
              <span>1h: {day(cov["1h"]?.first)} →</span>
              <span>Daily: {day(cov["1d"]?.first)} →</span>
            </div>
          ) : (
            <span className="text-warn">
              No {symbol} history stored yet. <button className="underline" onClick={onOpenData}>Load it in Market data</button> first.
            </span>
          )}
        </div>
        <div>
          <label className="label">Start date (replay begins here)</label>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">Chart timeframe</label>
          <select className="input" value={tf} onChange={(e) => setTf(e.target.value)}>
            {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Starting balance ($)</label>
          <input className="input font-mono" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div>
          <label className="label">Default risk per trade ($)</label>
          <input className="input font-mono" value={risk} onChange={(e) => setRisk(e.target.value)} />
        </div>
        <div>
          <label className="label">Fees per contract, round turn ($)</label>
          <input className="input font-mono" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-ink-faint mt-3">
        5-minute charts work for the last ~60 days, 1h/4h for ~2 years, daily/weekly back to 2000.
      </p>
    </Modal>
  );
}
