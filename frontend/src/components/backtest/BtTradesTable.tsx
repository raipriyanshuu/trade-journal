import { useState } from "react";
import { BtTrade, money } from "../../lib/backtestApi";
import { formatDateTime, formatDuration } from "../../lib/format";

export function avgExit(t: BtTrade): number | null {
  const q = t.exits.reduce((s, e) => s + e.qty, 0);
  return q ? Math.round((t.exits.reduce((s, e) => s + e.price * e.qty, 0) / q) * 1e6) / 1e6 : null;
}

function SetupCell({ t, onSave }: { t: BtTrade; onSave: (v: string) => void }) {
  const [v, setV] = useState(t.setup);
  return (
    <input className="input !py-0.5 !px-1.5 text-xs !w-32" list="bt-setups" value={v} placeholder="setup"
      onChange={(e) => setV(e.target.value)} onBlur={() => v !== t.setup && onSave(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function NotesCell({ t, onSave }: { t: BtTrade; onSave: (v: string) => void }) {
  const [v, setV] = useState(t.notes);
  return (
    <textarea className="input !py-0.5 !px-1.5 text-xs min-w-[180px]" rows={1} value={v} placeholder="notes"
      onChange={(e) => setV(e.target.value)} onBlur={() => v !== t.notes && onSave(v)} />
  );
}

/** Trades of a session (or of the dashboard selection), newest first. */
export default function BtTradesTable({ trades, tz, onPatch, onDelete, onView, showStrategy, snapVersion = "" }: {
  trades: BtTrade[];
  tz: string;
  onPatch?: (tid: number, patch: { setup?: string; notes?: string }) => void;
  onDelete?: (tid: number) => void;
  onView: (tid: number) => void;
  showStrategy?: boolean;
  snapVersion?: string;
}) {
  if (trades.length === 0) return <p className="text-sm text-ink-faint p-3">No trades yet.</p>;
  const rows = [...trades].sort((a, b) => (b.entry_time > a.entry_time ? 1 : -1));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-faint border-b border-card-border whitespace-nowrap text-xs">
            <th className="px-2 py-1.5 font-medium">Entry</th>
            {showStrategy && <th className="px-2 py-1.5 font-medium">Strategy</th>}
            <th className="px-2 py-1.5 font-medium">Dir</th>
            <th className="px-2 py-1.5 font-medium text-right">Qty</th>
            <th className="px-2 py-1.5 font-medium text-right">Entry px</th>
            <th className="px-2 py-1.5 font-medium text-right">Stop</th>
            <th className="px-2 py-1.5 font-medium text-right">Exit px</th>
            <th className="px-2 py-1.5 font-medium">Exit</th>
            <th className="px-2 py-1.5 font-medium text-right">Net</th>
            <th className="px-2 py-1.5 font-medium text-right">R</th>
            <th className="px-2 py-1.5 font-medium text-right" title="Max adverse / favourable excursion, points">MAE/MFE</th>
            <th className="px-2 py-1.5 font-medium">Held</th>
            <th className="px-2 py-1.5 font-medium">Setup</th>
            <th className="px-2 py-1.5 font-medium">Notes</th>
            <th className="px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const held = t.close_time ? (Date.parse(t.close_time) - Date.parse(t.entry_time)) / 1000 : null;
            return (
              <tr key={t.id} className="border-b border-card-border/40 align-top">
                <td className="px-2 py-1.5 whitespace-nowrap text-ink-muted text-xs">{formatDateTime(t.entry_time, tz)}</td>
                {showStrategy && <td className="px-2 py-1.5 text-xs">{t.strategy}</td>}
                <td className="px-2 py-1.5">
                  <span className={`badge ${t.direction === "long" ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"}`}>
                    {t.direction === "long" ? "Long" : "Short"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{t.qty}</td>
                <td className="px-2 py-1.5 text-right font-mono">{t.entry_price}</td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-muted">{t.initial_stop ?? "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{avgExit(t) ?? "—"}</td>
                <td className="px-2 py-1.5 text-xs">
                  {t.status === "open" ? <span className="badge bg-accent/15 text-accent-soft">open</span>
                    : <span className={`badge ${t.exit_reason === "stop" ? "bg-neg/15 text-neg" : t.exit_reason === "target" ? "bg-pos/15 text-pos" : "bg-card-border text-ink-muted"}`}>{t.exit_reason}</span>}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono ${t.net > 0 ? "text-pos" : t.net < 0 ? "text-neg" : ""}`}>
                  {t.status === "open" ? <span className="text-ink-faint">{money(t.unrealized)}</span> : money(t.net)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{t.r_multiple !== null ? `${t.r_multiple}R` : "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono text-xs text-ink-muted">{t.mae} / {t.mfe}</td>
                <td className="px-2 py-1.5 text-xs text-ink-muted whitespace-nowrap">{formatDuration(held)}</td>
                <td className="px-2 py-1.5">
                  {onPatch ? <SetupCell t={t} onSave={(v) => onPatch(t.id, { setup: v })} /> : <span className="text-xs">{t.setup || "—"}</span>}
                </td>
                <td className="px-2 py-1.5">
                  {onPatch ? <NotesCell t={t} onSave={(v) => onPatch(t.id, { notes: v })} /> : <span className="text-xs text-ink-muted">{t.notes}</span>}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-right">
                  {t.snapshot && (
                    <img src={`/api/backtest/trades/${t.id}/snapshot?v=${snapVersion}`} alt="chart" title="Chart at exit — click to enlarge"
                      className="inline h-8 rounded border border-card-border cursor-zoom-in mr-1" onClick={() => onView(t.id)} />
                  )}
                  {onDelete && (
                    <button className="text-xs text-ink-faint hover:text-neg" title="Delete trade"
                      onClick={() => confirm("Delete this backtest trade?") && onDelete(t.id)}>&times;</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
