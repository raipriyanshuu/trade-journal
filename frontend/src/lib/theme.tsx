import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export type ThemeName = "dark" | "light";

/** Concrete colours for charts (SVG/canvas can't read CSS variables). */
export interface Palette {
  bg: string;
  card: string;
  cardHover: string;
  border: string;
  grid: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  pos: string;
  neg: string;
  warn: string;
  tooltip: { background: string; border: string; fontSize: number; color: string };
}

const PALETTES: Record<ThemeName, Omit<Palette, "tooltip">> = {
  dark: {
    bg: "#0a0e17", card: "#141a27", cardHover: "#1a2130", border: "#232b3b", grid: "#1b2230",
    ink: "#e7ecf3", muted: "#9aa6b8", faint: "#6b7688",
    accent: "#6d6bf6", accentSoft: "#8f8dfb", pos: "#22c58b", neg: "#f0566b", warn: "#f3b53d",
  },
  light: {
    bg: "#f4f6fb", card: "#ffffff", cardHover: "#f1f4f9", border: "#dfe4ee", grid: "#edf0f5",
    ink: "#111827", muted: "#4b5563", faint: "#808a9c",
    accent: "#5b57e8", accentSoft: "#6360f0", pos: "#0d9666", neg: "#dc344e", warn: "#c4840e",
  },
};

function palette(theme: ThemeName): Palette {
  const p = PALETTES[theme];
  return { ...p, tooltip: { background: p.card, border: `1px solid ${p.border}`, fontSize: 12, color: p.ink } };
}

interface ThemeCtxValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
  c: Palette;
}

const KEY = "tj.theme";

function initialTheme(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* storage unavailable */ }
  return "dark";
}

const ThemeCtx = createContext<ThemeCtxValue>({
  theme: "dark", setTheme: () => {}, toggle: () => {}, c: palette("dark"),
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);
  return (
    <ThemeCtx.Provider value={{ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark"), c: palette(theme) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
