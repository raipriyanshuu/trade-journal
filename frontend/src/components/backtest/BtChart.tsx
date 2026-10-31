import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  ColorType, createChart, CrosshairMode, IChartApi, IPriceLine, ISeriesApi, LineStyle, UTCTimestamp,
} from "lightweight-charts";
import { Candle, Marker, VwapPoint } from "../../lib/backtestApi";
import { useTheme } from "../../lib/theme";

export interface ChartLine {
  id: string; // "draft-stop", "t12-stop" ...
  price: number;
  color: string;
  title: string;
  draggable?: boolean;
  dashed?: boolean;
}

export interface BtChartHandle {
  screenshot: () => Promise<Blob | null>;
}

interface Props {
  candles: Candle[];
  vwap: VwapPoint[];
  markers: Marker[];
  lines: ChartLine[];
  showVwap: boolean;
  showBands: boolean;
  showVolume: boolean;
  intraday: boolean;
  tick: number;
  resetKey: string; // changes when the whole series must be redrawn (session, timeframe, jump)
  onLineDrag: (id: string, price: number) => void;
  onPickPrice?: (price: number) => void;
}

const VWAP_COLOR = "#f3b53d";
const BAND1 = "rgba(243,181,61,0.55)";
const BAND2 = "rgba(243,181,61,0.3)";

const t = (x: number) => x as UTCTimestamp;

/**
 * Replay chart (TradingView Lightweight Charts). Candles arrive already cut at the
 * replay cursor; incremental updates touch only the tail so zoom/scroll stay put.
 */
const BtChart = forwardRef<BtChartHandle, Props>(function BtChart(props, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapS = useRef<ISeriesApi<"Line">[]>([]);
  const priceLines = useRef(new Map<string, IPriceLine>());
  const prev = useRef<{ key: string; candles: Candle[] }>({ key: "", candles: [] });
  const linesRef = useRef(props.lines);
  const dragRef = useRef<{ id: string; price: number } | null>(null);
  const cb = useRef({ onLineDrag: props.onLineDrag, onPickPrice: props.onPickPrice });
  cb.current = { onLineDrag: props.onLineDrag, onPickPrice: props.onPickPrice };
  linesRef.current = props.lines;
  const { c: pal } = useTheme();

  useImperativeHandle(ref, () => ({
    screenshot: () =>
      new Promise((resolve) => {
        if (!chart.current) return resolve(null);
        chart.current.takeScreenshot().toBlob((b) => resolve(b), "image/png");
      }),
  }));

  // Create the chart once.
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#141a27" }, textColor: "#9aa6b8", fontSize: 11 },
      grid: { vertLines: { color: "#1b2230" }, horzLines: { color: "#1b2230" } },
      rightPriceScale: { borderColor: "#232b3b" },
      timeScale: { borderColor: "#232b3b", timeVisible: true, secondsVisible: false, rightOffset: 8 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const cs = c.addCandlestickSeries({
      upColor: "#22c58b", downColor: "#f0566b", borderVisible: false,
      wickUpColor: "#22c58b", wickDownColor: "#f0566b",
    });
    const vs = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const line = (color: string, width: 1 | 2, style: LineStyle) =>
      c.addLineSeries({ color, lineWidth: width, lineStyle: style, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    vwapS.current = [
      line(VWAP_COLOR, 2, LineStyle.Solid),
      line(BAND1, 1, LineStyle.Solid), line(BAND1, 1, LineStyle.Solid),
      line(BAND2, 1, LineStyle.Dashed), line(BAND2, 1, LineStyle.Dashed),
    ];
    c.subscribeClick((param) => {
      if (!param.point || dragRef.current) return;
      const p = cs.coordinateToPrice(param.point.y);
      if (p !== null) cb.current.onPickPrice?.(p);
    });
    chart.current = c;
    candle.current = cs;
    volume.current = vs;

    // Drag stop/target lines with the mouse.
    const node = el.current;
    const near = (y: number) => {
      for (const l of linesRef.current) {
        if (!l.draggable) continue;
        const cy = cs.priceToCoordinate(l.price);
        if (cy !== null && Math.abs(cy - y) <= 6) return l;
      }
      return null;
    };
    const yOf = (e: MouseEvent) => e.clientY - node.getBoundingClientRect().top;
    const onDown = (e: MouseEvent) => {
      const l = near(yOf(e));
      if (!l) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { id: l.id, price: l.price };
      c.applyOptions({ handleScroll: false, handleScale: false });
    };
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) {
        if (e.target instanceof Node && node.contains(e.target)) node.style.cursor = near(yOf(e)) ? "ns-resize" : "";
        return;
      }
      const p = cs.coordinateToPrice(yOf(e));
      if (p === null) return;
      d.price = p;
      priceLines.current.get(d.id)?.applyOptions({ price: p });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      c.applyOptions({ handleScroll: true, handleScale: true });
      // Let the click that ends a drag pass before clearing (so it isn't a "pick").
      setTimeout(() => { dragRef.current = null; }, 0);
      cb.current.onLineDrag(d.id, d.price);
    };
    node.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      node.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      c.remove();
      chart.current = null;
      priceLines.current.clear();
      prev.current = { key: "", candles: [] };
    };
  }, []);

  useEffect(() => {
    chart.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: pal.card }, textColor: pal.muted },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.border },
      timeScale: { borderColor: pal.border },
    });
    candle.current?.applyOptions({ upColor: pal.pos, downColor: pal.neg, wickUpColor: pal.pos, wickDownColor: pal.neg });
  }, [pal]);

  useEffect(() => {
    chart.current?.applyOptions({ timeScale: { timeVisible: props.intraday } });
  }, [props.intraday]);

  useEffect(() => {
    const decimals = Math.max(0, (String(props.tick).split(".")[1] ?? "").length);
    candle.current?.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: props.tick } });
  }, [props.tick]);

  // Candles + volume.
  useEffect(() => {
    const cs = candle.current, vs = volume.current, c = chart.current;
    if (!cs || !vs || !c) return;
    const { candles, resetKey } = props;
    const p = prev.current;
    const toC = (x: Candle) => ({ time: t(x.time), open: x.open, high: x.high, low: x.low, close: x.close });
    const toV = (x: Candle) => ({ time: t(x.time), value: x.volume, color: x.close >= x.open ? "rgba(34,197,139,0.35)" : "rgba(240,86,107,0.35)" });
    const incremental = p.key === resetKey && p.candles.length > 0 && candles.length >= p.candles.length
      && candles[0].time === p.candles[0].time && candles.length - p.candles.length < 500;
    if (incremental) {
      for (let i = p.candles.length - 1; i < candles.length; i++) {
        cs.update(toC(candles[i]));
        vs.update(toV(candles[i]));
      }
    } else {
      cs.setData(candles.map(toC));
      vs.setData(candles.map(toV));
      if (p.key !== resetKey && candles.length) {
        // Fixed zoom anchored at the latest bar (works before the chart knows its width).
        c.timeScale().applyOptions({ barSpacing: 8 });
        c.timeScale().scrollToPosition(8, false);
      }
    }
    prev.current = { key: resetKey, candles };
  }, [props.candles, props.resetKey]);

  useEffect(() => {
    volume.current?.applyOptions({ visible: props.showVolume });
  }, [props.showVolume]);

  // VWAP and bands (gap at each session reset).
  useEffect(() => {
    const [mid, u1, l1, u2, l2] = vwapS.current;
    if (!mid) return;
    const pts = props.showVwap ? props.vwap : [];
    // A segment takes the colour of its starting point: hide each session's last
    // point so the line doesn't join one day's VWAP to the next.
    const hide = (arr: VwapPoint[], i: number) => (arr[i + 1]?.new_day ? { color: "rgba(0,0,0,0)" } : {});
    const mk = (f: (p: VwapPoint) => number) => pts.map((p, i) => ({ time: t(p.time), value: f(p), ...hide(pts, i) }));
    mid.setData(mk((p) => p.vwap));
    const bands = props.showBands ? pts : [];
    const mb = (f: (p: VwapPoint) => number) => bands.map((p, i) => ({ time: t(p.time), value: f(p), ...hide(bands, i) }));
    u1.setData(mb((p) => p.vwap + p.sd));
    l1.setData(mb((p) => p.vwap - p.sd));
    u2.setData(mb((p) => p.vwap + 2 * p.sd));
    l2.setData(mb((p) => p.vwap - 2 * p.sd));
  }, [props.vwap, props.showVwap, props.showBands]);

  // Trade markers (only on candles we have).
  useEffect(() => {
    const cs = candle.current;
    if (!cs) return;
    const first = props.candles[0]?.time ?? Infinity;
    cs.setMarkers(props.markers.filter((m) => m.time >= first).map((m) => ({ ...m, time: t(m.time) })));
  }, [props.markers, props.candles]);

  // Price lines (rebuilt unless one is being dragged).
  useEffect(() => {
    const cs = candle.current;
    if (!cs || dragRef.current) return;
    priceLines.current.forEach((pl) => cs.removePriceLine(pl));
    priceLines.current.clear();
    for (const l of props.lines) {
      priceLines.current.set(l.id, cs.createPriceLine({
        price: l.price, color: l.color, lineWidth: l.draggable ? 2 : 1,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title,
      }));
    }
  }, [props.lines]);

  return <div ref={el} className="w-full h-full" />;
});

export default BtChart;
