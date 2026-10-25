// Backtest API client: talks only to /api/backtest (data lives in backtest.db).

export const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1D", "1W"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const INTRADAY: Timeframe[] = ["5m", "15m", "30m", "1h", "4h"];

export interface BtInstrument {
  symbol: string;
  name: string;
  yahoo: string;
  tick: number;
  point_value: number;
  micro: string;
  micro_point_value: number;
  fee_full: number;
  fee_micro: number;
  coverage: Record<string, { first: string; last: string; bars: number }>;
}

export interface BtSession {
  id: number;
  name: string;
  strategy: string;
  symbol: string;
  contract: "full" | "micro";
  contract_label: string;
  point_value: number;
  tick_size: number;
  starting_balance: number;
  risk_per_trade: number;
  fee_per_contract: number;
  timeframe: Timeframe;
  start_at: string;
  revealed_until: string;
  notes: string;
  archived: boolean;
  trades: number;
  open_trades: number;
  win_rate: number;
  net: number;
  balance: number;
}

export interface BtExit { ts: number; price: number; qty: number; reason: string }

export interface BtTrade {
  id: number;
  session_id: number;
  symbol: string;
  direction: "long" | "short";
  qty: number;
  remaining: number;
  entry_time: string;
  entry_price: number;
  initial_stop: number | null;
  stop: number | null;
  target: number | null;
  status: "open" | "closed";
  exits: BtExit[];
  exit_reason: string | null;
  close_time: string | null;
  gross: number;
  fees: number;
  net: number;
  r_multiple: number | null;
  mae: number;
  mfe: number;
  setup: string;
  notes: string;
  snapshot: boolean;
  unrealized: number;
  strategy?: string;
}

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface VwapPoint { time: number; vwap: number; sd: number; new_day: boolean }
export interface Marker { time: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown" | "circle"; text: string }
export interface TradeLine { trade_id: number; kind: "entry" | "stop" | "target"; price: number }
export interface BtEvent { trade_id: number; reason: string; price: number; net: number; r: number | null }

export interface BtState {
  session: BtSession;
  tf: Timeframe;
  chart: { tf: Timeframe; candles: Candle[]; vwap: VwapPoint[]; tail_from: number | null; step_base: string | null; at_end: boolean };
  incremental: boolean;
  markers: Marker[];
  lines: TradeLine[];
  last: { price: number | null; time: string };
  trades: BtTrade[];
  balance: number;
  equity: number;
  open_pnl: number;
  events: BtEvent[];
  message: string | null;
  tz: string;
}

export interface GroupRow {
  key: string; trades: number; win_rate: number; net: number; profit_factor: number | null;
  expectancy: number; expectancy_r: number | null; total_r: number | null;
}

export interface BtStats {
  kpis: Record<string, number | null>;
  equity: { n: number; time: number | null; equity: number; r: number }[];
  by_strategy: GroupRow[];
  by_setup: GroupRow[];
  by_symbol: GroupRow[];
  by_direction: GroupRow[];
  by_exit: GroupRow[];
  by_weekday: GroupRow[];
  by_hour: GroupRow[];
  r_distribution: { bucket: string; count: number }[];
  trades: BtTrade[];
  tz: string;
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backtest${path}`, {
    headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body: unknown) => req<T>(path, { method: "POST", body: JSON.stringify(body) });

export const bt = {
  instruments: () => req<BtInstrument[]>("/instruments"),
  loadData: (symbol: string) => post<{ symbol: string; result: Record<string, { fetched: number }> }>(`/data/${symbol}/load`, {}),

  sessions: () => req<BtSession[]>("/sessions"),
  createSession: (body: Record<string, unknown>) => post<BtSession>("/sessions", body),
  updateSession: (id: number, patch: Partial<BtSession>) =>
    req<BtSession>(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSession: (id: number) => req<void>(`/sessions/${id}`, { method: "DELETE" }),

  state: (id: number, tf: Timeframe, since?: number | null) =>
    req<BtState>(`/sessions/${id}/state?tf=${tf}${since != null ? `&since=${since}` : ""}`),
  step: (id: number, body: { tf: Timeframe; mode: "bar" | "candle"; count?: number; since?: number | null }) =>
    post<BtState>(`/sessions/${id}/step`, body),
  jump: (id: number, to: string, tf: Timeframe) => post<BtState>(`/sessions/${id}/jump`, { to, tf }),

  order: (id: number, body: { direction: string; qty: number; stop?: number | null; target?: number | null; setup?: string; notes?: string; tf: Timeframe; since?: number | null }) =>
    post<BtState>(`/sessions/${id}/orders`, body),
  updateTrade: (tid: number, body: { stop?: number | null; target?: number | null; setup?: string; notes?: string; tf: Timeframe; since?: number | null }) =>
    req<BtState>(`/trades/${tid}`, { method: "PATCH", body: JSON.stringify(body) }),
  closeTrade: (tid: number, body: { qty?: number | null; tf: Timeframe; since?: number | null }) =>
    post<BtState>(`/trades/${tid}/close`, body),
  deleteTrade: (tid: number) => req<void>(`/trades/${tid}`, { method: "DELETE" }),
  uploadSnapshot: (tid: number, png: Blob) => {
    const fd = new FormData();
    fd.append("file", png, `trade-${tid}.png`);
    return req<{ ok: boolean }>(`/trades/${tid}/snapshot`, { method: "POST", body: fd });
  },
  snapshotUrl: (tid: number, bust = "") => `/api/backtest/trades/${tid}/snapshot${bust ? `?v=${bust}` : ""}`,

  stats: (params: { strategy?: string; symbol?: string; session_id?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.append(k, String(v)); });
    return req<BtStats>(`/stats?${qs}`);
  },
  strategies: () => req<string[]>("/strategies"),
  setups: () => req<string[]>("/setups"),
};

/** Merge an incremental chart tail into the candles we already have. */
export function mergeTail<T extends { time: number }>(prev: T[], tail: T[]): T[] {
  if (tail.length === 0) return prev;
  const from = tail[0].time;
  let i = prev.length;
  while (i > 0 && prev[i - 1].time >= from) i--;
  return [...prev.slice(0, i), ...tail];
}

export const money = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
