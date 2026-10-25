import { useEffect, useState } from "react";
import { api } from "./api";

// Trade styles (Scalp / Intraday / Swing / Positional + your own), shared by
// every picker and filter. One fetch per page load; `reload` after changes.
let cache: string[] | null = null;
const listeners = new Set<(s: string[]) => void>();

function publish(styles: string[]) {
  cache = styles;
  listeners.forEach((fn) => fn(styles));
}

export function reloadStyles(): Promise<string[]> {
  return api.listStyles().then((s) => { publish(s); return s; });
}

export function useStyles() {
  const [styles, setStyles] = useState<string[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setStyles);
    if (cache === null) reloadStyles().catch(() => {});
    return () => { listeners.delete(setStyles); };
  }, []);
  return { styles, reload: reloadStyles, save: (s: string[]) => api.setStyles(s).then((r) => { publish(r); return r; }) };
}

const TONES = [
  "bg-sky-500/15 text-sky-300",
  "bg-amber-500/15 text-amber-300",
  "bg-pos/15 text-pos",
  "bg-violet-500/15 text-violet-300",
  "bg-pink-500/15 text-pink-300",
  "bg-teal-500/15 text-teal-300",
];
const FIXED: Record<string, string> = {
  scalp: TONES[0], intraday: TONES[1], swing: TONES[2], positional: TONES[3],
};

/** Stable colour per style name. */
export function styleTone(name: string): string {
  const key = name.toLowerCase();
  if (FIXED[key]) return FIXED[key];
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[4 + (h % 2)];
}

// Remember the last style used per instrument (crude = swing, ES = scalp...).
const LAST_KEY = "tj.lastStyleByInstrument";

export function lastStyleFor(instrumentId: number | null | undefined): string | null {
  if (!instrumentId) return null;
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, string>)[instrumentId] ?? null;
  } catch {
    return null;
  }
}

export function rememberStyle(instrumentId: number | null | undefined, style: string | null | undefined) {
  if (!instrumentId || !style) return;
  try {
    const map = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, string>;
    map[instrumentId] = style;
    localStorage.setItem(LAST_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: just don't remember */
  }
}
