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

export interface DailySession {
  id: number;
  account_id: number | null;
  instrument_id: number | null;
  trading_date: string;
  htf_read: string;
  prior_day_type: string | null;
  prior_profile_shape: string | null;
  prior_vah: string | null;
  prior_poc: string | null;
  prior_val: string | null;
  on_high: string | null;
  on_low: string | null;
  on_poc: string | null;
  on_vwap: string | null;
  on_range_vs_atr: string | null;
  on_inventory: string | null;
  expected_open_location: string | null;
  levels: { label: string; price: string }[];
  scenarios: Record<string, unknown>[];
  news_events: Record<string, unknown>[];
  actual_opening_type: string | null;
  actual_day_type: string | null;
  scenario_played_out: string | null;
  followed_plan: string | null;
  what_to_repeat: string;
  what_to_change: string;
  mood: number | null;
  sleep: number | null;
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
  listTags: (includeArchived = false) =>
    request<Tag[]>(`/api/tags${includeArchived ? "?include_archived=true" : ""}`),
  createTag: (name: string, category: string) =>
    request<Tag>("/api/tags", { method: "POST", body: JSON.stringify({ name, category }) }),
  updateTag: (id: number, patch: { name?: string; category?: string; archived?: boolean }) =>
    request<Tag>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  mergeTags: (id: number, intoId: number) =>
    request<Tag>(`/api/tags/${id}/merge/${intoId}`, { method: "POST" }),
  deleteTag: (id: number) => request<void>(`/api/tags/${id}`, { method: "DELETE" }),

  // Journal
  getJournal: (date: string, accountId?: number | null, instrumentId?: number | null) => {
    const qs = new URLSearchParams({ trading_date: date });
    if (accountId) qs.append("account_id", String(accountId));
    if (instrumentId) qs.append("instrument_id", String(instrumentId));
    return request<DailySession | null>(`/api/journal?${qs}`);
  },
  previousJournal: (date: string, accountId?: number | null, instrumentId?: number | null) => {
    const qs = new URLSearchParams({ trading_date: date });
    if (accountId) qs.append("account_id", String(accountId));
    if (instrumentId) qs.append("instrument_id", String(instrumentId));
    return request<DailySession | null>(`/api/journal/previous?${qs}`);
  },
  upsertJournal: (payload: Partial<DailySession> & { trading_date: string }) =>
    request<DailySession>("/api/journal", { method: "PUT", body: JSON.stringify(payload) }),
  bulkTag: (tradeIds: number[], add: number[], remove: number[]) =>
    request<{ updated: number }>("/api/trades/bulk-tag", {
      method: "POST",
      body: JSON.stringify({ trade_ids: tradeIds, add, remove }),
    }),

  // Mistakes
  mistakesAnalytics: (filters: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.append(k, String(v)); });
    return request<any>(`/api/mistakes/analytics?${qs}`);
  },
  listFlags: (tradeId: number) =>
    request<Array<{ id: number; trade_id: number | null; rule_code: string; source: string; details: string; dismissed: boolean; explanation: string }>>(`/api/mistakes/flags?trade_id=${tradeId}`),
  addFlag: (tradeId: number, ruleCode: string, details = "") =>
    request<any>("/api/mistakes/flags", { method: "POST", body: JSON.stringify({ trade_id: tradeId, rule_code: ruleCode, details }) }),
  dismissFlag: (id: number, dismissed: boolean) =>
    request<any>(`/api/mistakes/flags/${id}/dismiss`, { method: "POST", body: JSON.stringify({ dismissed }) }),
  deleteFlag: (id: number) => request<void>(`/api/mistakes/flags/${id}`, { method: "DELETE" }),
  recomputeMistakes: () => request<{ flags: number }>("/api/mistakes/recompute", { method: "POST" }),

  // Analytics
  dashboard: (filters: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.append(k, String(v)); });
    return request<any>(`/api/analytics/dashboard?${qs}`);
  },
  calendar: (filters: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.append(k, String(v)); });
    return request<Record<string, { net: number; trades: number; win_rate: number }>>(`/api/analytics/calendar?${qs}`);
  },
  breakdown: (dimension: string, filters: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams({ dimension });
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.append(k, String(v)); });
    return request<Array<{ key: string; trades: number; win_rate: number; net_pnl: string; avg_pnl: number; profit_factor: number | null; expectancy_r: number | null }>>(`/api/analytics/breakdown?${qs}`);
  },
  dimensions: () => request<string[]>("/api/analytics/dimensions"),
  getMistakeRules: () => request<{ rules: Record<string, any>; explanations: Record<string, string> }>("/api/mistakes/rules"),
  mistakeDrilldown: (type: string, filters: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams({ type });
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.append(k, String(v)); });
    return request<TradeSummary[]>(`/api/mistakes/drilldown?${qs}`);
  },

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

  // Import
  previewImport: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/import/preview", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status}: preview failed`);
    return res.json() as Promise<{ headers: string[]; rows: Record<string, string>[]; delimiter: string }>;
  },
  runImport: async (file: File, config: Record<string, unknown>) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("config", JSON.stringify(config));
    const res = await fetch("/api/import/run", { method: "POST", body: fd });
    if (!res.ok) {
      let detail = "import failed";
      try { detail = (await res.json()).detail ?? detail; } catch { /* */ }
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json() as Promise<{ batch_id: number; rows_read: number; imported: number; skipped: number; failed: number; errors: string[] }>;
  },
  listBatches: () =>
    request<Array<{ id: number; source: string; filename: string | null; rows_read: number; rows_imported: number; rows_skipped: number; rows_failed: number; status: string; created_at: string; profile_name: string | null }>>("/api/import/batches"),
  undoBatch: (id: number) => request<{ status: string }>(`/api/import/batches/${id}`, { method: "DELETE" }),
  listProfiles: () =>
    request<Array<{ id: number; name: string; format: string; config: Record<string, unknown> }>>("/api/import/profiles"),
  saveProfile: (name: string, format: string, config: Record<string, unknown>) =>
    request<{ id: number }>("/api/import/profiles", { method: "POST", body: JSON.stringify({ name, format, config }) }),
  deleteProfile: (id: number) => request<void>(`/api/import/profiles/${id}`, { method: "DELETE" }),

  restoreBackup: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/export/restore", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status}: restore failed`);
    return res.json() as Promise<{ status: string; message?: string }>;
  },

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
