import { useState } from "react";
import Modal from "../Modal";
import { bt, BtInstrument } from "../../lib/backtestApi";

/** Download / update Yahoo history for each backtest instrument. */
export default function DataModal({ instruments, onClose, onChanged }: {
  instruments: BtInstrument[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function load(symbols: string[]) {
    for (const s of symbols) {
      setBusy(s);
      try {
        const r = await bt.loadData(s);
        const n = Object.values(r.result).reduce((a, x) => a + x.fetched, 0);
        setMsg((m) => ({ ...m, [s]: `updated (${n.toLocaleString()} bars received)` }));
      } catch (e) {
        setMsg((m) => ({ ...m, [s]: (e as Error).message }));
      }
      onChanged();
    }
    setBusy(null);
  }

  const span = (c?: { first: string; last: string; bars: number }) =>
    c ? `${c.first.slice(0, 10)} → ${c.last.slice(0, 10)} · ${c.bars.toLocaleString()}` : "—";

  return (
    <Modal wide title="Market data for backtesting" open onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-primary" disabled={busy !== null} onClick={() => load(instruments.map((i) => i.symbol))}>
          {busy ? `Loading ${busy}…` : "Load / update all"}
        </button>
      </>
    }>
      <p className="text-sm text-ink-muted mb-3">
        Free delayed history from Yahoo Finance (continuous front-month futures). Only the ticker and a date range are
        sent. Yahoo keeps 5-minute bars ~60 days, hourly ~2 years and daily back to 2000. Updating regularly keeps
        extending your stored 5-minute history, because bars already saved are never deleted.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-faint border-b border-card-border">
            <th className="py-1.5 pr-2 font-medium">Instrument</th>
            <th className="py-1.5 pr-2 font-medium">5m</th>
            <th className="py-1.5 pr-2 font-medium">1h</th>
            <th className="py-1.5 pr-2 font-medium">Daily</th>
            <th className="py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {instruments.map((i) => (
            <tr key={i.symbol} className="border-b border-card-border/40 align-top">
              <td className="py-2 pr-2">
                <div className="font-mono font-semibold">{i.symbol}</div>
                <div className="text-xs text-ink-faint">{i.name} · {i.yahoo}</div>
                {msg[i.symbol] && <div className="text-xs text-ink-muted mt-0.5">{msg[i.symbol]}</div>}
              </td>
              <td className="py-2 pr-2 text-xs font-mono text-ink-muted">{span(i.coverage["5m"])}</td>
              <td className="py-2 pr-2 text-xs font-mono text-ink-muted">{span(i.coverage["1h"])}</td>
              <td className="py-2 pr-2 text-xs font-mono text-ink-muted">{span(i.coverage["1d"])}</td>
              <td className="py-2 text-right">
                <button className="btn-ghost !py-1 text-xs" disabled={busy !== null} onClick={() => load([i.symbol])}>
                  {busy === i.symbol ? "Loading…" : Object.keys(i.coverage).length ? "Update" : "Load"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
