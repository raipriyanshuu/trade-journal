import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Playbook } from "../lib/api";
import { formatMoney } from "../lib/format";
import PlaybookEditor from "../components/playbooks/PlaybookEditor";
import { tone } from "../components/playbooks/shared";

type Sort = "name" | "net" | "win" | "trades";

function netValue(pb: Playbook): number {
  return Object.values(pb.stats?.net_by_ccy ?? {}).reduce((s, v) => s + Number(v), 0);
}

/** Your strategies / models, each with its rules and how it performs. */
export default function Playbooks() {
  const nav = useNavigate();
  const [list, setList] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [editing, setEditing] = useState<Playbook | null | "new">(null);

  const load = () => {
    setLoading(true);
    api.listPlaybooks({ include_archived: showArchived }).then(setList).finally(() => setLoading(false));
  };
  useEffect(load, [showArchived]);

  const sorted = [...list].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (sort === "net") return netValue(b) - netValue(a);
    if (sort === "win") return (b.stats?.win_rate ?? 0) - (a.stats?.win_rate ?? 0);
    if (sort === "trades") return (b.stats?.trades ?? 0) - (a.stats?.trades ?? 0);
    return a.name.localeCompare(b.name);
  });

  async function act(pb: Playbook, what: "edit" | "duplicate" | "archive" | "delete") {
    if (what === "edit") return setEditing(pb);
    if (what === "duplicate") await api.duplicatePlaybook(pb.id);
    if (what === "archive") await api.updatePlaybook(pb.id, { archived: !pb.archived });
    if (what === "delete") {
      const n = (pb.stats?.trades ?? 0) + (pb.stats?.missed ?? 0);
      if (!confirm(`Delete "${pb.name}" and its rules?${n ? ` Its ${n} trade(s) stay in your journal, just without a playbook.` : ""}`)) return;
      await api.deletePlaybook(pb.id);
    }
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks</h1>
          <p className="text-sm text-ink-muted">Your strategies and their rules. Tick the rules you followed on each trade to see what actually works.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <select className="input !w-auto !py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name A–Z</option>
            <option value="net">Net P&amp;L</option>
            <option value="win">Win rate</option>
            <option value="trades">Most trades</option>
          </select>
          <button className="btn-primary" onClick={() => setEditing("new")}>+ Create playbook</button>
        </div>
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading&hellip;</p> : sorted.length === 0 ? (
        <div className="card p-10 text-center">
          <h2 className="text-lg font-semibold mb-1">Write down how you trade</h2>
          <p className="text-sm text-ink-muted mb-4">
            A playbook is one setup or model with a checklist of rules: market context, entry, exit and risk.
            Start from a template or from scratch, and edit it any time.
          </p>
          <button className="btn-primary" onClick={() => setEditing("new")}>+ Create playbook</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((pb) => <PlaybookCard key={pb.id} pb={pb} onOpen={() => nav(`/playbooks/${pb.id}`)} onAction={(a) => act(pb, a)} />)}
        </div>
      )}

      {editing && (
        <PlaybookEditor playbook={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={(pb) => { setEditing(null); if (editing === "new") nav(`/playbooks/${pb.id}`); else load(); }} />
      )}
    </div>
  );
}

function PlaybookCard({ pb, onOpen, onAction }: {
  pb: Playbook; onOpen: () => void; onAction: (a: "edit" | "duplicate" | "archive" | "delete") => void;
}) {
  const s = pb.stats;
  const net = Object.entries(s?.net_by_ccy ?? {});
  const wr = Math.round((s?.win_rate ?? 0) * 100);
  return (
    <div className={`card p-4 cursor-pointer hover:border-accent/50 transition-colors ${pb.archived ? "opacity-60" : ""}`} onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center font-semibold shrink-0 ${tone(pb.color).chip}`}>
            {pb.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="font-semibold truncate">{pb.name}</div>
            <div className="text-xs text-ink-faint">
              {s?.trades ?? 0} trades{s?.missed ? ` · ${s.missed} missed` : ""} · {pb.rules.length} rules{pb.archived ? " · archived" : ""}
            </div>
          </div>
        </div>
        <CardMenu pb={pb} onAction={onAction} />
      </div>
      <div className="flex items-center gap-4 mt-4">
        <Ring pct={wr} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 flex-1">
          <div><div className="text-xs text-ink-faint">Win rate</div><div className="font-mono font-semibold">{wr}%</div></div>
          <div>
            <div className="text-xs text-ink-faint">Net P&amp;L</div>
            <div className="font-mono font-semibold">
              {net.length === 0 ? "—" : net.map(([ccy, v]) => (
                <span key={ccy} className={`block ${Number(v) >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(v, ccy)}</span>
              ))}
            </div>
          </div>
          <div><div className="text-xs text-ink-faint">Profit factor</div><div className="font-mono text-sm">{s?.profit_factor ?? (s?.wins ? "∞" : "—")}</div></div>
          <div>
            <div className="text-xs text-ink-faint">Rules followed</div>
            <div className="font-mono text-sm">{s?.adherence != null ? `${Math.round(s.adherence * 100)}%` : "—"}</div>
          </div>
        </div>
      </div>
      {pb.description && <p className="text-xs text-ink-muted mt-3 line-clamp-2">{pb.description}</p>}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 20, circ = 2 * Math.PI * r;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0" aria-hidden>
      <circle cx="26" cy="26" r={r} fill="none" strokeWidth="6" className="stroke-card-border" />
      <circle cx="26" cy="26" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
        className={pct >= 50 ? "stroke-pos" : "stroke-neg"}
        strokeDasharray={`${(pct / 100) * circ} ${circ}`} transform="rotate(-90 26 26)" />
    </svg>
  );
}

function CardMenu({ pb, onAction }: { pb: Playbook; onAction: (a: "edit" | "duplicate" | "archive" | "delete") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const item = (a: "edit" | "duplicate" | "archive" | "delete", label: string, cls = "") => (
    <button className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-card-hover ${cls}`}
      onClick={(e) => { e.stopPropagation(); setOpen(false); onAction(a); }}>{label}</button>
  );
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button className="text-ink-faint hover:text-ink px-1.5 text-lg leading-none" aria-label="Playbook actions" onClick={() => setOpen((o) => !o)}>&middot;&middot;&middot;</button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-40 card py-1 shadow-lg">
          {item("edit", "Edit rules")}
          {item("duplicate", "Duplicate")}
          {item("archive", pb.archived ? "Unarchive" : "Archive")}
          {item("delete", "Delete", "text-neg")}
        </div>
      )}
    </div>
  );
}
