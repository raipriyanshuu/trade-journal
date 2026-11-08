import { useEffect, useRef, useState } from "react";
import { IChartApi, ISeriesApi, Logical } from "lightweight-charts";

export type DrawingType = "line" | "hline" | "box" | "circle";
export type Tool = "cursor" | DrawingType | "erase";

export interface Drawing {
  id: string;
  type: DrawingType;
  t1: number; // chart time (seconds), may lie beyond the last bar
  p1: number;
  t2?: number;
  p2?: number;
  color: string;
}

export const DRAW_COLORS = ["#f3b53d", "#8f8dfb", "#22c58b", "#f0566b", "#38bdf8", "#e5e7eb"];

/**
 * SVG layer over a lightweight-charts chart for simple drawings. Shapes are kept
 * in time/price so they stay on the right candles when you scroll or zoom.
 */
export default function ChartDrawings({ chart, series, times, drawings, onChange, tool, color }: {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  times: number[]; // candle times, ascending
  drawings: Drawing[];
  onChange: (d: Drawing[]) => void;
  tool: Tool;
  color: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState<Drawing | null>(null);

  // Redraw whenever the chart moves (scroll, zoom, price-scale drag, resize).
  useEffect(() => {
    if (!chart) return;
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.subscribeCrosshairMove(bump);
    const ro = new ResizeObserver(bump);
    if (box.current) ro.observe(box.current);
    bump();
    return () => {
      cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
      chart.unsubscribeCrosshairMove(bump);
      ro.disconnect();
    };
  }, [chart]);

  if (!chart || !series || times.length === 0) return <div ref={box} className="absolute inset-0 pointer-events-none" />;

  const step = times.length > 1 ? times[1] - times[0] : 60;
  const last = times.length - 1;

  // time <-> logical bar index (extrapolated past the ends so shapes can extend).
  const timeToLogical = (t: number): number => {
    if (t <= times[0]) return (t - times[0]) / step;
    if (t >= times[last]) return last + (t - times[last]) / step;
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid; else hi = mid;
    }
    return lo + (t - times[lo]) / Math.max(1, times[hi] - times[lo]);
  };
  const logicalToTime = (l: number): number => {
    const i = Math.round(l);
    if (i <= 0) return times[0] + i * step;
    if (i >= last) return times[last] + (i - last) * step;
    return times[i];
  };
  const X = (t: number) => chart.timeScale().logicalToCoordinate(timeToLogical(t) as Logical);
  const Y = (p: number) => series.priceToCoordinate(p);

  function point(e: React.MouseEvent) {
    const r = box.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const l = chart!.timeScale().coordinateToLogical(x);
    const p = series!.coordinateToPrice(y);
    if (l === null || p === null) return null;
    return { t: logicalToTime(l), p };
  }

  const drawing = tool !== "cursor" && tool !== "erase";

  function down(e: React.MouseEvent) {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    const pt = point(e);
    if (!pt) return;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (tool === "hline") {
      onChange([...drawings, { id, type: "hline", t1: pt.t, p1: pt.p, color }]);
      return;
    }
    setDraft({ id, type: tool as DrawingType, t1: pt.t, p1: pt.p, t2: pt.t, p2: pt.p, color });
  }
  function move(e: React.MouseEvent) {
    if (!draft) return;
    const pt = point(e);
    if (pt) setDraft({ ...draft, t2: pt.t, p2: pt.p });
  }
  function up() {
    if (!draft) return;
    const x1 = X(draft.t1), x2 = X(draft.t2!), y1 = Y(draft.p1), y2 = Y(draft.p2!);
    const moved = x1 !== null && x2 !== null && y1 !== null && y2 !== null && Math.hypot(x2 - x1, y2 - y1) > 4;
    if (moved) onChange([...drawings, draft]);
    setDraft(null);
  }

  const width = box.current?.clientWidth ?? 0;
  const shape = (d: Drawing, preview = false) => {
    const x1 = X(d.t1), y1 = Y(d.p1);
    if (y1 === null) return null;
    const common = {
      stroke: d.color, strokeWidth: 2, strokeDasharray: preview ? "5 4" : undefined,
      style: { pointerEvents: (tool === "erase" && !preview ? "visiblePainted" : "none") as "visiblePainted" | "none", cursor: tool === "erase" ? "pointer" : undefined },
      onClick: tool === "erase" && !preview ? () => onChange(drawings.filter((x) => x.id !== d.id)) : undefined,
    };
    if (d.type === "hline") return <line key={d.id} x1={0} x2={width} y1={y1} y2={y1} {...common} />;
    const x2 = X(d.t2!), y2 = Y(d.p2!);
    if (x1 === null || x2 === null || y2 === null) return null;
    if (d.type === "line") return <line key={d.id} x1={x1} y1={y1} x2={x2} y2={y2} {...common} strokeLinecap="round" />;
    const fill = `${d.color}22`;
    if (d.type === "box") {
      return <rect key={d.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={fill} {...common} />;
    }
    return <ellipse key={d.id} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} fill={fill} {...common} />;
  };

  return (
    <div ref={box} className="absolute inset-0"
      style={{ pointerEvents: drawing ? "auto" : "none", cursor: drawing ? "crosshair" : undefined, zIndex: 3 }}
      onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}>
      <svg className="w-full h-full" style={{ overflow: "hidden" }}>
        {drawings.map((d) => shape(d))}
        {draft && shape(draft, true)}
      </svg>
    </div>
  );
}
