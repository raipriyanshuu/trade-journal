import { createContext, ReactNode, useContext, useState } from "react";
import { setApiSegment } from "./api";
import { formatMoney } from "./format";

/**
 * The journal is two separate books: futures and options. The selected book
 * scopes every trade list, dashboard, calendar, report and playbook stat
 * (api.ts adds ?segment= to those requests).
 */
export type Segment = "futures" | "options";

const KEY = "tj.segment";

function initial(): Segment {
  try {
    return localStorage.getItem(KEY) === "options" ? "options" : "futures";
  } catch {
    return "futures";
  }
}

const Ctx = createContext<{ segment: Segment; setSegment: (s: Segment) => void }>({
  segment: "futures", setSegment: () => {},
});

export function SegmentProvider({ children }: { children: ReactNode }) {
  const [segment, setState] = useState<Segment>(initial);
  // Set synchronously so child requests made during this render already use it.
  setApiSegment(segment);
  const setSegment = (s: Segment) => {
    setApiSegment(s);
    try { localStorage.setItem(KEY, s); } catch { /* storage unavailable */ }
    setState(s);
  };
  return <Ctx.Provider value={{ segment, setSegment }}>{children}</Ctx.Provider>;
}

export const useSegment = () => useContext(Ctx);

/**
 * Currency for money on analytics pages. The Options book is Indian (always ₹).
 * In Futures: the currency filter if set, else the data's own currency, else
 * `fallback`; with no fallback, amounts stay plain numbers rather than risk
 * showing $ on MCX/NSE futures.
 */
export function useMoney({ currency, byCcy, fallback }: {
  currency?: string;
  byCcy?: Record<string, unknown> | null;
  fallback?: string;
} = {}) {
  const { segment } = useSegment();
  const ccy = currency || (segment === "options" ? "INR" : Object.keys(byCcy ?? {})[0]) || fallback || null;
  const money = (v: number | string | null | undefined) => {
    if (v === null || v === undefined || v === "") return "—";
    if (ccy) return formatMoney(v, ccy);
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  };
  return { ccy: ccy ?? "USD", money, known: !!ccy };
}
