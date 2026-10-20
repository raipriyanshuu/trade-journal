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

  useEffect(() => {
    api.replay(tradeId).then(setData).catch((e) => setErr((e as Error).message));
  }, [tradeId]);

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

    // Snap each marker onto the candle that contains it, so it always renders.
    const times = candles.map((c) => c.time as number);
    const snap = (t: number) => {
      let best = times[0];
      for (const ct of times) if (ct <= t) best = ct;
      return best as UTCTimestamp;
    };
    series.setMarkers(
      data.markers
        .map((m) => ({
          time: snap(m.time), position: m.position as SeriesMarkerPosition, color: m.color,
          shape: m.shape as SeriesMarkerShape, text: m.text,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number)),
    );
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
      <div className="bg-bg-soft rounded-lg p-6 text-center text-sm text-ink-muted">
        No bar data covers this trade yet. Import 1m or 5m bars for {data.symbol} in{" "}
        <Link to="/data" className="text-accent-soft hover:underline">Import / Export &rarr; Bar data</Link> to replay it and get MAE/MFE.
      </div>
    );
  }

  const ex = data.excursion;
  return (
    <div>
      <div ref={el} className="h-[380px] w-full rounded-lg overflow-hidden" />
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">
        <span className="text-ink-faint">{data.timeframe} bars &middot; times in {data.tz}</span>
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
