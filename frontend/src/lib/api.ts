// Tiny typed fetch wrapper around the local backend API.

export interface Instrument {
  id: number;
  symbol_root: string;
  display_name: string;
  exchange: string;
  currency: string;
  point_value: string;
  tick_size: string;
  lot_size: string;
  asset_class: string;
  quantity_unit: string;
  session_timezone: string;
  session_definitions: Record<string, unknown>;
  active: boolean;
  verified: boolean;
}

export interface Account {
  id: number;
  name: string;
  platform: string | null;
  type: string;
  currency: string;
  starting_balance: string;
  active: boolean;
  is_demo: boolean;
  account_size: string | null;
  profit_target: string | null;
  daily_loss_limit: string | null;
  max_drawdown_type: string | null;
  max_drawdown_amount: string | null;
  consistency_pct: string | null;
  min_trading_days: number | null;
  max_contracts: number | null;
}

export interface DemoStatus {
  present: boolean;
  accounts: number;
  executions: number;
  trades: number;
}

export type Settings = Record<string, unknown>;

export interface Tag {
  id: number;
  name: string;
  category: string;
}

export interface ExecutionRow {
  id: number;
  account_id: number;
  instrument_id: number;
  side: string;
  quantity: string;
  price: string;
  timestamp: string;
  fees: string;
  source: string;
  external_id: string | null;
  time_known: boolean;
  trade_id: number | null;
}

export interface AttachmentRow {
  id: number;
  file_path: string;
  original_name: string | null;
  mime_type: string | null;
}

export interface TradeSummary {
  id: number;
  account_id: number;
  account_name: string;
  instrument_id: number;
  symbol: string;
  direction: string;
  trading_date: string;
  open_time: string;
  close_time: string | null;
  status: string;
  max_position_size: string;
  avg_entry: string | null;
  avg_exit: string | null;
  points: string | null;
  gross_pnl: string;
  fees: string;
  net_pnl: string;
  currency: string;
  r_multiple: string | null;
  holding_time_seconds: number | null;
  source: string;
  scenario: string;
  self_rating: number | null;
  pnl_only: boolean;
  time_known: boolean;
  is_demo: boolean;
  result: string;
  tags: Tag[];
}

export interface TradeDetail extends TradeSummary {
  initial_stop: string | null;
  planned_target: string | null;
  planned_risk_amount: string | null;
  first_entry_price: string | null;
  planned: boolean | null;
  checklist_score: number | null;
  vwap_relation: string;
  entry_location: string;
  notes: string;
  executions: ExecutionRow[];
  attachments: AttachmentRow[];
}

export interface Leg {
  time: string;
  price: string;
  quantity: string;
}

export interface ManualTradePayload {
  account_id: number;
  instrument_id: number;
  direction: string;
  entries: Leg[];
  exits: Leg[];
  fees?: string;
  initial_stop?: string | null;
  planned_target?: string | null;
  planned_risk_amount?: string | null;
  scenario?: string;
  planned?: boolean | null;
  checklist_score?: number | null;
  vwap_relation?: string;
  entry_location?: string;
  notes?: string;
  self_rating?: number | null;
  tag_ids?: number[];
  time_known?: boolean;
}

export interface TradeFilters {
  date_from?: string;
  date_to?: string;
  account_id?: number;
  instrument_id?: number;
  direction?: string;
  result?: string;
  status?: string;
  scenario?: string;
  source?: string;
  tag_id?: number;
  include_demo?: boolean;
  sort_by?: string;
  order?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/api/health"),

  // Instruments
  listInstruments: () => request<Instrument[]>("/api/instruments"),
  updateInstrument: (id: number, patch: Partial<Instrument>) =>
    request<Instrument>(`/api/instruments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  verifyInstrument: (id: number) =>
    request<Instrument>(`/api/instruments/${id}/verify`, { method: "POST" }),
  createInstrument: (data: Partial<Instrument>) =>
    request<Instrument>("/api/instruments", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Accounts
  listAccounts: () => request<Account[]>("/api/accounts"),
  createAccount: (data: Partial<Account>) =>
    request<Account>("/api/accounts", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id: number, patch: Partial<Account>) =>
    request<Account>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteAccount: (id: number) =>
    request<void>(`/api/accounts/${id}`, { method: "DELETE" }),

  // Settings
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (patch: Settings) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  // Demo
  demoStatus: () => request<DemoStatus>("/api/demo"),
  loadDemo: () => request<Record<string, unknown>>("/api/demo/load", { method: "POST" }),
  clearDemo: () => request<Record<string, unknown>>("/api/demo/clear", { method: "POST" }),

  // Tags
  listTags: () => request<Tag[]>("/api/tags"),

  // Trades
  listTrades: (filters: TradeFilters = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
    });
    const q = qs.toString();
    return request<TradeSummary[]>(`/api/trades${q ? `?${q}` : ""}`);
  },
  getTrade: (id: number) => request<TradeDetail>(`/api/trades/${id}`),
  createManualTrade: (payload: ManualTradePayload) =>
    request<TradeDetail>("/api/trades/manual", { method: "POST", body: JSON.stringify(payload) }),
  updateTrade: (id: number, patch: Partial<ManualTradePayload> & { pnl_only?: boolean }) =>
    request<TradeDetail>(`/api/trades/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTrade: (id: number) => request<void>(`/api/trades/${id}`, { method: "DELETE" }),

  // Executions
  updateExecution: (id: number, patch: Partial<ExecutionRow>) =>
    request<ExecutionRow>(`/api/executions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteExecution: (id: number) => request<void>(`/api/executions/${id}`, { method: "DELETE" }),

  // Attachments
  uploadAttachment: async (tradeId: number, file: File | Blob, filename = "paste.png") => {
    const fd = new FormData();
    fd.append("file", file, filename);
    const res = await fetch(`/api/trades/${tradeId}/attachments`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status}: upload failed`);
    return res.json() as Promise<AttachmentRow>;
  },
  deleteAttachment: (id: number) =>
    request<void>(`/api/attachments/${id}`, { method: "DELETE" }),
};
