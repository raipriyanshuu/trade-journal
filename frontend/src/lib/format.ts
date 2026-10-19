// Money / number formatting helpers. Never mixes currencies.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  INR: "₹",
};

export function currencySymbol(ccy: string): string {
  return CURRENCY_SYMBOL[ccy] ?? ccy + " ";
}

export function formatMoney(value: string | number | null | undefined, ccy: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${sign}${currencySymbol(ccy)}${abs}`;
}

export function pnlColor(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "text-ink-muted";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n) || n === 0) return "text-ink-muted";
  return n > 0 ? "text-pos" : "text-neg";
}

export function formatDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatTimeOnly(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * Convert a browser-local `datetime-local` string (interpreted in the display
 * time zone) to a UTC ISO string for the API. The input has no zone; we treat
 * it as the user's local clock, which matches the datetime-local widget.
 */
export function localInputToUtcIso(value: string): string {
  // `new Date("2026-10-14T14:00")` is parsed as local time by the browser.
  return new Date(value).toISOString();
}

/** UTC ISO -> value for a datetime-local input, shown in the given tz. */
export function utcIsoToLocalInput(iso: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return iso.slice(0, 16);
  }
}
