import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api } from "../lib/api";
import AnalyticsFilterBar, { AnalyticsFilters } from "../components/AnalyticsFilterBar";

const POS = "#22c58b";
const NEG = "#f0566b";
const GRID = "#232b3b";

export default function Excursions() {
  const nav = useNavigate();
  const [filters, setFilters] = useState<AnalyticsFilters>({ include_demo: true });
  const [adverse, setAdverse] = useState(0.5);
  const [unit, setUnit] = useState<"r" | "points">("r");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.maeMfe({ ...(filters as any), adverse_r: adverse }).then(setData);
  }, [JSON.stringify(filters), adverse]);

  const pts: any[] = data?.points ?? [];
  const hasR = pts.some((p) => p.mae_r !== null);
  const u = unit === "r" && hasR ? "r" : "points";
  const key = (k: "mae" | "mfe") => (u === "r" ? `${k}_r` : `${k}_points`);
  const series = (result: string) =>
    pts.filter((p) => p.result === result && p[key("mae")] !== null).map((p) => ({ ...p, x: p[key("mae")], y: p[key("mfe")] }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">MAE / MFE</h1>
          <p className="text-sm text-ink-muted">How far trades went against you (MAE) and for you (MFE) before the exit. Needs imported bars.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label">Winners in drawdown beyond</label>
            <div className="flex items-center gap-1">
              <input className="input !w-20 font-mono" type="number" step="0.1" value={adverse} onChange={(e) => setAdverse(Number(e.target.value) || 0)} />
              <span className="text-sm text-ink-muted">R</span>
            </div>
          </div>
          <div className="flex p-1 bg-bg-soft rounded-lg">
            {(["r", "points"] as const).map((x) => (
              <button key={x} onClick={() => setUnit(x)} className={`px-3 py-1 rounded-md text-xs font-medium ${unit === x ? "bg-card text-ink" : "text-ink-muted"}`}>
                {x === "r" ? "R" : "Points"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      {!data ? <p className="text-ink-muted text-sm">Loading&hellip;</p> : data.covered_trades === 0 ? (
        <div className="card p-10 text-center text-ink-muted space-y-3">
          <p>
            None of the {data.closed_trades} closed trades in range have bar coverage yet.
            For ES / Gold / Crude, turn on delayed charts in{" "}
            <button className="text-accent-soft hover:underline" onClick={() => nav("/settings?tab=market")}>Settings &rarr; Market data</button>
            {" "}and fetch them; for anything else import bars in{" "}
            <button className="text-accent-soft hover:underline" onClick={() => nav("/data")}>Import / Export &rarr; Bar data</button>.
          </p>
          <BackfillButton onDone={() => api.maeMfe({ ...(filters as any), adverse_r: adverse }).then(setData)} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Kpi label="Trades with bars" value={`${data.covered_trades} / ${data.closed_trades}`} />
            <Kpi label={`Winners beyond ${data.adverse_r_threshold}R heat`} value={data.winners_beyond_threshold_pct === null ? "—" : `${data.winners_beyond_threshold_pct}%`}
              hint="High = your stop may be too tight; low = stops could be tighter." />
            <Kpi label="Avg exit efficiency" value={data.avg_exit_efficiency_pct === null ? "—" : `${data.avg_exit_efficiency_pct}%`}
              hint="Share of the favourable move captured on winners." />
            <Kpi label="Avg winner MAE" value={data.avg_winner_mae_r === null ? "—" : `${data.avg_winner_mae_r}R`} />
            <Kpi label="Losers that were up 1R+" value={String(data.losers_that_were_up_1r)} hint="Trades worth managing (breakeven stop / partials)." cls={data.losers_that_were_up_1r ? "text-warn" : ""} />
          </div>

          <div className="card p-4">
            <h3 className="font-medium text-sm mb-1">MAE vs MFE ({u === "r" ? "R" : "points"})</h3>
            <p className="text-xs text-ink-faint mb-3">Each dot is a trade. Bottom-right = heat without reward. Top-left = clean trades. Click a dot to open it.</p>
            <ResponsiveContainer width="100%" height={380}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis type="number" dataKey="x" name="MAE" tick={{ fill: "#6b7688", fontSize: 10 }}
                  label={{ value: `MAE (${u === "r" ? "R" : "pts"})`, position: "insideBottom", offset: -10, fill: "#6b7688", fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name="MFE" tick={{ fill: "#6b7688", fontSize: 10 }} width={44} />
                <ZAxis range={[50, 50]} />
                {u === "r" && <ReferenceLine x={data.adverse_r_threshold} stroke="#f3b53d" strokeDasharray="4 3" />}
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#141a27", border: "1px solid #232b3b", fontSize: 12 }}
                  formatter={(v: number) => v.toFixed(2)}
                  labelFormatter={() => ""} />
                <Scatter name="Winners" data={series("win")} fill={POS} onClick={(p: any) => nav(`/trades/${p.trade_id}`)} cursor="pointer" />
                <Scatter name="Losers" data={series("loss")} fill={NEG} onClick={(p: any) => nav(`/trades/${p.trade_id}`)} cursor="pointer" />
                <Scatter name="Breakeven" data={series("breakeven")} fill="#9aa6b8" onClick={(p: any) => nav(`/trades/${p.trade_id}`)} cursor="pointer" />
              </ScatterChart>
            </ResponsiveContainer>
            {unit === "r" && !hasR && <p className="text-xs text-warn mt-2">No trades in range have a stop or planned risk, so R can't be computed &mdash; showing points.</p>}
          </div>

          <div className="card overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint border-b border-card-border">
                  {["Date", "Symbol", "Result", "MAE", "MFE", "Captured", "Net"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {pts.map((p) => (
                  <tr key={p.trade_id} className="border-b border-card-border/40 hover:bg-card-hover cursor-pointer" onClick={() => nav(`/trades/${p.trade_id}`)}>
                    <td className="px-3 py-1.5">{p.date}</td>
                    <td className="px-3 py-1.5 font-mono">{p.symbol}</td>
                    <td className={`px-3 py-1.5 ${p.result === "win" ? "text-pos" : p.result === "loss" ? "text-neg" : "text-ink-muted"}`}>{p.result}</td>
                    <td className="px-3 py-1.5 font-mono text-neg">{p.mae_points} pts{p.mae_r !== null ? ` / ${p.mae_r.toFixed(2)}R` : ""}</td>
                    <td className="px-3 py-1.5 font-mono text-pos">{p.mfe_points} pts{p.mfe_r !== null ? ` / ${p.mfe_r.toFixed(2)}R` : ""}</td>
                    <td className="px-3 py-1.5 font-mono">{p.captured_pct === null ? "—" : `${p.captured_pct}%`}</td>
                    <td className={`px-3 py-1.5 font-mono ${p.net_pnl >= 0 ? "text-pos" : "text-neg"}`}>{p.net_pnl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function BackfillButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.marketDataBackfill();
      setMsg(`${r.fetched} charts fetched, ${r.cached} already stored, ${r.failed} failed.`);
      onDone();
    } catch (e) {
      setMsg((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="btn-primary" onClick={run} disabled={busy}>{busy ? "Fetching charts…" : "Fetch delayed charts for recent CME trades"}</button>
      {msg && <p className="text-xs mt-2">{msg}</p>}
    </div>
  );
}

function Kpi({ label, value, hint, cls = "" }: { label: string; value: string; hint?: string; cls?: string }) {
  return (
    <div className="card p-3" title={hint}>
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-lg font-semibold font-mono mt-0.5 ${cls}`}>{value}</div>
      {hint && <div className="text-[10px] text-ink-faint mt-0.5 leading-tight">{hint}</div>}
    </div>
  );
}
