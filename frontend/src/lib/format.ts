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
