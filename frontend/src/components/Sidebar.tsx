import { NavLink } from "react-router-dom";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  phase?: number; // shown as a small "soon" marker until that phase lands
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "■", phase: 5 },
  { to: "/trades", label: "Trade Log", icon: "≡" },
  { to: "/journal", label: "Daily Journal", icon: "✎" },
  { to: "/mistakes", label: "Mistakes", icon: "⚠", phase: 4 },
  { to: "/analytics", label: "Analytics", icon: "◑", phase: 5 },
  { to: "/prop", label: "Prop Tracker", icon: "◈", phase: 6 },
  { to: "/data", label: "Import / Export", icon: "⤓" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-card-border bg-bg-soft flex flex-col">
      <div className="h-14 flex items-center px-4 border-b border-card-border">
        <span className="text-accent-soft text-lg font-bold tracking-tight">Trade</span>
        <span className="text-ink text-lg font-bold tracking-tight">Journal</span>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-accent/15 text-ink font-medium"
                  : "text-ink-muted hover:bg-card hover:text-ink"
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
      </nav>
      <div className="p-3 text-xs text-ink-faint border-t border-card-border">
        Local &middot; 127.0.0.1 &middot; v0.1
      </div>
    </aside>
  );
}
