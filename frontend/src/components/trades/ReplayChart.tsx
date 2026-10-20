import { useEffect, useRef, useState } from "react";
import {
  ColorType, createChart, CrosshairMode, LineStyle, SeriesMarkerPosition, SeriesMarkerShape, UTCTimestamp,
} from "lightweight-charts";
import { Link } from "react-router-dom";
import { api, ReplayData } from "../../lib/api";

const LINE_STYLES = [LineStyle.Solid, LineStyle.Dotted, LineStyle.Dashed];

export default function ReplayChart({ tradeId }: { tradeId: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ReplayData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const autoTried = useRef(false);

  const load = () => api.replay(tradeId).then(setData).catch((e) => setErr((e as Error).message));

  async function fetchChart(force = false) {
    setFetching(true);
    setFetchErr(null);
    try {
      await api.fetchTradeBars(tradeId, force);
      await load();
    } catch (e) {
      setFetchErr((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    autoTried.current = false;
    load();
  }, [tradeId]);

  // No chart yet but a delayed one is available: fetch it automatically, once.
  useEffect(() => {
    if (data && data.candles.length === 0 && data.can_fetch && data.fetch_enabled && !autoTried.current) {
      autoTried.current = true;
      fetchChart();
    }
  }, [data]);

  useEffect(() => {
    if (!el.current || !data || data.candles.length === 0) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#141a27" }, textColor: "#9aa6b8", fontSize: 11 },
      grid: { vertLines: { color: "#1b2230" }, horzLines: { color: "#1b2230" } },
      rightPriceScale: { borderColor: "#232b3b" },
      timeScale: { borderColor: "#232b3b", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22c58b", downColor: "#f0566b", borderVisible: false,
      wickUpColor: "#22c58b", wickDownColor: "#f0566b",
    });
    const candles = data.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp }));
    series.setData(candles);

    // Snap each fill onto the candle that contains it (markers need a data point).
    const times = candles.map((c) => c.time as number);
    const snap = (t: number) => {
      let best = times[0];
      for (const ct of times) if (ct <= t) best = ct;
      return best as UTCTimestamp;
    };
    const fills = [...data.fills].sort((a, b) => a.time - b.time);

    // Dashed path from entry to exit through every fill (one point per candle).
    const path = new Map<number, number>();
    for (const f of fills) if (!f.missed) path.set(snap(f.time) as number, f.price);
    if (path.size >= 2) {
      const pathSeries = chart.addLineSeries({
        color: "#8f8dfb", lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false,
        priceLineVisible: false, crosshairMarkerVisible: false,
      });
      pathSeries.setData([...path.entries()].map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    }

    // Each fill is its own tiny invisible series so the arrow sits at the exact
    // fill price ("inBar") instead of under/over the candle.
    for (const f of fills) {
      const t = snap(f.time);
      const color = f.missed ? "#f3b53d" : f.matched === false ? "#f3b53d" : f.side === "buy" ? "#22c58b" : "#f0566b";
      const s = chart.addLineSeries({
        lineVisible: false, pointMarkersVisible: false, lastValueVisible: false,
        priceLineVisible: false, crosshairMarkerVisible: false,
      });
      s.setData([{ time: t, value: f.price }]);
      const label = f.missed
        ? `missed ${f.side} @ ${f.price}`
        : `${f.is_entry ? "IN" : "OUT"} ${f.side} ${f.quantity} @ ${f.price}${f.matched === false ? " ⚠" : ""}`;
      s.setMarkers([{
        time: t, position: "inBar" as SeriesMarkerPosition, color,
        shape: (f.missed ? "circle" : f.side === "buy" ? "arrowUp" : "arrowDown") as SeriesMarkerShape,
        text: label,
      }]);
    }
    for (const l of data.lines) {
      series.createPriceLine({
        price: l.price, color: l.color, lineWidth: 1, lineStyle: LINE_STYLES[l.style] ?? LineStyle.Dashed,
        axisLabelVisible: true, title: l.title,
      });
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data]);

  if (err) return <p className="text-neg text-sm">{err}</p>;
  if (!data) return <p className="text-ink-faint text-sm">Loading chart&hellip;</p>;
  if (data.candles.length === 0) {
    return (
      <div className="bg-bg-soft rounded-lg p-6 text-center text-sm text-ink-muted space-y-2">
        {fetching ? (
          <p>Fetching the delayed {data.symbol} chart from Yahoo Finance&hellip;</p>
        ) : data.can_fetch && data.fetch_enabled ? (
          <>
            <p>{fetchErr ?? "No chart stored for this trade yet."}</p>
            <button className="btn-primary" onClick={() => fetchChart()}>Fetch delayed chart</button>
          </>
        ) : data.can_fetch ? (
          <p>
            Turn on delayed charts in{" "}
            <Link to="/settings?tab=market" className="text-accent-soft hover:underline">Settings &rarr; Market data</Link>{" "}
            to load this {data.symbol} chart automatically, or import bars in{" "}
            <Link to="/data" className="text-accent-soft hover:underline">Import / Export &rarr; Bar data</Link>.
          </p>
        ) : (
          <p>
            No bar data covers this trade yet. Import 1m or 5m bars for {data.symbol} in{" "}
            <Link to="/data" className="text-accent-soft hover:underline">Import / Export &rarr; Bar data</Link> to replay it and get MAE/MFE.
          </p>
        )}
      </div>
    );
  }

  const ex = data.excursion;
  const fromYahoo = data.sources.includes("yahoo");
  return (
    <div>
      <div ref={el} className="h-[380px] w-full rounded-lg overflow-hidden" />
      {data.fill_warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <div className="font-medium text-warn mb-1">&#9888; Fill prices don&rsquo;t match the chart at the logged times</div>
          <ul className="list-disc ml-5 space-y-0.5 text-ink-muted">
            {data.fill_warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <p className="text-xs text-ink-faint mt-1">Fix the times under Executions (Edit) and the chart, MAE/MFE and time-of-day stats update automatically.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">
        <span className="text-ink-faint">
          {data.timeframe} bars &middot; times in {data.tz}
          {fromYahoo && <> &middot; Yahoo Finance (delayed, continuous front-month)</>}
          {data.can_fetch && data.fetch_enabled && (
            <button className="ml-2 text-accent-soft hover:underline" onClick={() => fetchChart(true)} disabled={fetching}>
              {fetching ? "refreshing…" : "refresh"}
            </button>
          )}
        </span>
        {ex && (
          <>
            <span>MFE <span className="font-mono text-pos">{ex.mfe_points} pts{ex.mfe_r !== null ? ` · ${ex.mfe_r.toFixed(2)}R` : ""}</span></span>
            <span>MAE <span className="font-mono text-neg">{ex.mae_points} pts{ex.mae_r !== null ? ` · ${ex.mae_r.toFixed(2)}R` : ""}</span></span>
            {ex.captured_pct !== null && (
              <span>Captured <span className="font-mono text-accent-soft">{ex.captured_pct}%</span> of the move</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
