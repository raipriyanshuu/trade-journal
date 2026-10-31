/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme colours are CSS variables (RGB triples) set in index.css for the
        // dark and light themes, so opacity utilities like bg-pos/15 still work.
        bg: {
          DEFAULT: "rgb(var(--tj-bg) / <alpha-value>)",
          soft: "rgb(var(--tj-bg-soft) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--tj-card) / <alpha-value>)",
          hover: "rgb(var(--tj-card-hover) / <alpha-value>)",
          border: "rgb(var(--tj-card-border) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--tj-ink) / <alpha-value>)",
          muted: "rgb(var(--tj-ink-muted) / <alpha-value>)",
          faint: "rgb(var(--tj-ink-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--tj-accent) / <alpha-value>)",
          soft: "rgb(var(--tj-accent-soft) / <alpha-value>)",
        },
        pos: "rgb(var(--tj-pos) / <alpha-value>)",
        neg: "rgb(var(--tj-neg) / <alpha-value>)",
        warn: "rgb(var(--tj-warn) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
