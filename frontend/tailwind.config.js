/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark, dense trading-tool palette.
        bg: {
          DEFAULT: "#0a0e17",
          soft: "#0f1420",
        },
        card: {
          DEFAULT: "#141a27",
          hover: "#1a2130",
          border: "#232b3b",
        },
        ink: {
          DEFAULT: "#e7ecf3",
          muted: "#9aa6b8",
          faint: "#6b7688",
        },
        accent: {
          DEFAULT: "#6d6bf6",
          soft: "#8f8dfb",
        },
        pos: "#22c58b",
        neg: "#f0566b",
        warn: "#f3b53d",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
