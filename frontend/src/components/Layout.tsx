import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import { useSegment } from "../lib/segment";

// Pages that aren't split into futures / options books.
const UNSCOPED = ["/backtest", "/settings", "/data"];

export default function Layout() {
  const { segment, setSegment } = useSegment();
  const { pathname } = useLocation();
  const scoped = !UNSCOPED.some((p) => pathname.startsWith(p));
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto p-6">
          {scoped && (
            <div className="flex items-center justify-between mb-4">
              <div className="flex p-1 bg-card border border-card-border rounded-xl" role="tablist" aria-label="Book">
                {(["futures", "options"] as const).map((s) => (
                  <button key={s} role="tab" aria-selected={segment === s} onClick={() => setSegment(s)}
                    className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      segment === s ? "bg-accent text-white shadow-sm" : "text-ink-muted hover:text-ink"}`}>
                    {s === "futures" ? "Futures" : "Options"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-ink-faint">
                Showing <span className="text-ink font-medium">{segment}</span> trades only
              </span>
            </div>
          )}
          {/* Keyed by book so every page reloads its data when you switch. */}
          <Outlet key={scoped ? segment : "all"} />
        </div>
      </main>
    </div>
  );
}
