import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ReportCardTrade, Shape } from "../../lib/api";
import { formatMoney, formatTimeOnly, pnlColor } from "../../lib/format";
import { useConfig } from "../../lib/config";
import { MistakeChips, ResultBadge, SideBadge, TagChips } from "../journal/Pickers";
import { AnnotatedThumb } from "../annotate/Annotations";
import EditableText from "../EditableText";
import Lightbox from "../Lightbox";
import StarButton from "./StarButton";

type Show = "all" | "mistakes" | "wins" | "losses" | "missed";
type Sort = "due" | "newest";

const SHOWS: { key: Show; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mistakes", label: "With mistakes" },
  { key: "losses", label: "Losses" },
  { key: "wins", label: "Wins" },
  { key: "missed", label: "Missed" },
];

const hasMistake = (t: ReportCardTrade) =>
  t.tags.some((g) => g.category === "mistake") || t.manual_flags.length > 0 || t.auto_flags.length > 0;

function ago(iso: string | null): string {
  if (!iso) return "Never reviewed";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "Reviewed today" : days === 1 ? "Reviewed yesterday" : `Reviewed ${days} days ago`;
}

/** Starred trades as cards to read again: write-up, behaviour, screenshots. */
export default function StarredReview() {
  const [rows, setRows] = useState<ReportCardTrade[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("due");

  useEffect(() => {
    api.starredTrades().then(setRows).catch((e) => setErr((e as Error).message));
  }, []);

  const list = useMemo(() => {
    const f = (rows ?? []).filter((t) =>
      show === "all" ? true
        : show === "mistakes" ? hasMistake(t)
        : show === "missed" ? t.status === "missed"
        : show === "wins" ? t.status !== "missed" && t.result === "win"
        : t.status !== "missed" && t.result === "loss");
    return [...f].sort((a, b) => sort === "newest"
      ? b.open_time.localeCompare(a.open_time)
      // Least recently reviewed first (never reviewed at the very top).
      : (a.last_reviewed_at ?? "").localeCompare(b.last_reviewed_at ?? "") || b.open_time.localeCompare(a.open_time));
  }, [rows, show, sort]);

  const update = (t: ReportCardTrade) => setRows((r) => (r ?? []).map((x) => (x.id === t.id ? t : x)));
  const remove = (id: number) => setRows((r) => (r ?? []).filter((x) => x.id !== id));

  if (err) return <p className="text-neg text-sm">{err}</p>;
  if (!rows) return <p className="text-ink-muted text-sm">Loading…</p>;
  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-ink-muted mb-1">No starred trades yet.</p>
        <p className="text-xs text-ink-faint">
          Click the ☆ next to any trade (here in the log or on the trade page) to keep it for review: a mistake you
          don't want to repeat, or something you did well.
        </p>
      </div>
    );
  }

  const due = rows.filter((t) => !t.last_reviewed_at || Date.now() - new Date(t.last_reviewed_at).getTime() > 7 * 86_400_000).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Show">
          {SHOWS.map((s) => (
            <button key={s.key} onClick={() => setShow(s.key)}
              className={`btn !py-1 !px-3 text-xs ${show === s.key ? "bg-accent/25 text-ink" : "bg-card-hover text-ink-faint"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-ink-muted">
            {rows.length} starred · <span className={due ? "text-warn" : "text-pos"}>{due} not looked at this week</span>
          </span>
          <select className="input !w-auto !py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="due">Least recently reviewed first</option>
            <option value="newest">Newest trades first</option>
          </select>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="card p-8 text-center text-ink-faint text-sm">Nothing starred in this group.</div>
      ) : (
        <div className="space-y-4">
          {list.map((t) => <ReviewCard key={t.id} t={t} onChange={update} onUnstar={() => remove(t.id)} />)}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ t, onChange, onUnstar }: {
  t: ReportCardTrade; onChange: (t: ReportCardTrade) => void; onUnstar: () => void;
}) {
  const { tz } = useConfig();
  const [viewer, setViewer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const src = (p: string) => `/attachments/${p}`;
  const missed = t.status === "missed";

  async function reviewed() {
    setBusy(true);
    try {
      const r = await api.markReviewed(t.id);
      onChange({ ...t, last_reviewed_at: r.last_reviewed_at });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <StarButton tradeId={t.id} starred onChange={(s) => !s && onUnstar()} />
        <span className="text-xs text-ink-faint whitespace-nowrap">
          {t.trading_date}{t.time_known ? ` · ${formatTimeOnly(t.open_time, tz)}` : ""}
        </span>
        <Link to={`/trades/${t.id}`} className="font-mono font-semibold hover:text-accent-soft">{t.symbol}</Link>
        <SideBadge trade={t} />
        {missed ? <span className="badge bg-card-border text-ink-muted">missed</span> : <ResultBadge result={t.result} partial={t.partial_profit} />}
        {!missed && (
          <span className={`font-mono font-semibold ${t.pnl_known ? pnlColor(t.net_pnl) : "text-ink-faint"}`}>
            {t.pnl_known ? formatMoney(t.net_pnl, t.currency) : "P&L unknown"}
          </span>
        )}
        {t.r_multiple != null && <span className="text-xs font-mono text-ink-faint">{Number(t.r_multiple).toFixed(2)}R</span>}
        <span className="text-xs text-ink-faint">{t.account_name}</span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
        <span className="flex items-center gap-1"><span className="text-ink-faint">Mistakes</span> <MistakeChips trade={t} /></span>
        <span className="flex items-center gap-1"><span className="text-ink-faint">Emotion</span> <TagChips tags={t.tags} category="emotion" /></span>
        <span className="flex items-center gap-1"><span className="text-ink-faint">Setup</span> <TagChips tags={t.tags} category="setup" /></span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {t.context && <p className="text-sm"><span className="text-ink-faint text-xs block">Context</span>{t.context}</p>}
          {t.behaviour && <p className="text-sm"><span className="text-ink-faint text-xs block">Behaviour</span>{t.behaviour}</p>}
          <div>
            <span className="text-ink-faint text-xs block mb-1">Notes / lesson</span>
            <EditableText value={t.notes} rows={4} placeholder="What should future-you remember about this trade?"
              onSave={async (v) => { await api.updateTrade(t.id, { notes: v }); onChange({ ...t, notes: v }); }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 content-start">
          {t.attachments.length === 0 && <p className="text-xs text-ink-faint">No screenshots. Add them on the trade page.</p>}
          {t.attachments.map((a, i) => (
            <AnnotatedThumb key={a.id} src={src(a.file_path)} shapes={a.annotations}
              className="h-44 w-auto rounded-lg border border-card-border cursor-zoom-in" title="Open (you can draw on it)"
              onClick={() => setViewer(i)} />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-card-border text-xs">
        <span className="text-ink-faint">{ago(t.last_reviewed_at)}</span>
        <span className="flex gap-1">
          <Link to={`/trades/${t.id}`} className="btn-ghost !py-1">Open trade</Link>
          <button className="btn-primary !py-1" onClick={reviewed} disabled={busy}>✓ Reviewed</button>
        </span>
      </div>

      {viewer !== null && t.attachments[viewer] && (
        <Lightbox images={t.attachments.map((a) => ({ src: src(a.file_path), name: a.original_name, id: a.id, annotations: a.annotations }))}
          index={viewer} onIndex={setViewer} onClose={() => setViewer(null)}
          onAnnotationsSaved={(id: number, shapes: Shape[]) =>
            onChange({ ...t, attachments: t.attachments.map((a) => (a.id === id ? { ...a, annotations: shapes } : a)) })} />
      )}
    </div>
  );
}
