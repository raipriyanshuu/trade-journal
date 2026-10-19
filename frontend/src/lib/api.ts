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
};
