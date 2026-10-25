import { NavLink } from "react-router-dom";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  phase?: number; // shown as a small "soon" marker until that phase lands
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Journal",
    items: [
      { to: "/journal", label: "Trading Day", icon: "✎" },
      { to: "/trades", label: "Trade Log", icon: "≡" },
      { to: "/calendar", label: "P&L Calendar", icon: "▦" },
    ],
  },
  {
    title: "Analyze",
    items: [
      { to: "/", label: "Dashboard", icon: "■" },
      { to: "/analytics", label: "Breakdowns", icon: "◑" },
      { to: "/mistakes", label: "Mistakes", icon: "⚠" },
    ],
  },
  {
    title: "Review",
    items: [
      { to: "/reports", label: "Reports", icon: "☰" },
      { to: "/excursions", label: "MAE / MFE", icon: "↔" },
      { to: "/prop", label: "Prop Tracker", icon: "◈", phase: 6 },
    ],
  },
  {
    title: "Practice",
    items: [
      { to: "/backtest", label: "Backtest", icon: "⟲" },
    ],
  },
  {
    title: "Data",
    items: [
      { to: "/data", label: "Import / Export", icon: "⤓" },
      { to: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-card-border bg-bg-soft flex flex-col">
      <div className="h-14 flex items-center px-4 border-b border-card-border">
        <span className="text-accent-soft text-lg font-bold tracking-tight">Trade</span>
        <span className="text-ink text-lg font-bold tracking-tight">Journal</span>
      </div>
      <nav className="flex-1 p-2 overflow-y-auto">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-3">
            <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-ink-faint">{g.title}</div>
            <div className="space-y-0.5">
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      isActive ? "bg-accent/15 text-ink font-medium" : "text-ink-muted hover:bg-card hover:text-ink"
                    }`
                  }
                >
                  <span className="w-4 text-center text-ink-faint">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.phase && item.phase > 0 ? (
                    <span className="badge bg-card-border text-ink-faint">P{item.phase}</span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="p-3 text-xs text-ink-faint border-t border-card-border">
        Local &middot; 127.0.0.1 &middot; v0.2
      </div>
    </aside>
  );
}
