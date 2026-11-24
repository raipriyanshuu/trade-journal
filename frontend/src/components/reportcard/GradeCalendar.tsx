import { useEffect, useState } from "react";
import { api, RCDay, RCStats } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { gradeTone } from "../journal/Pickers";

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const RESULT_DOT: Record<string, string> = { hit: "bg-pos", partly: "bg-warn", missed: "bg-neg" };
const compact = (v: number, ccy: string) => formatMoney(Math.round(v), ccy);

/** Month of day grades (click a day to open its card) plus what the grades say. */
export default function GradeCalendar({ selected, onSelect, refreshKey }: {
  selected: string; onSelect: (d: string) => void; refreshKey: unknown;
}) {
  const [month, setMonth] = useState(() => selected.slice(0, 7));
  const [days, setDays] = useState<Record<string, RCDay>>({});
  const [stats, setStats] = useState<RCStats | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => { setMonth(selected.slice(0, 7)); }, [selected]);

  const first = new Date(`${month}-01T12:00:00`);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  useEffect(() => {
    api.reportCards(iso(first), iso(last)).then((r) => {
      setDays(Object.fromEntries(r.days.map((d) => [d.date, d])));
      setStats(r.stats);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, refreshKey]);

  const lead = (first.getDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= last.getDate(); d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  const shift = (n: number) => setMonth(iso(new Date(first.getFullYear(), first.getMonth() + n, 1, 12)).slice(0, 7));
  const today = iso(new Date());

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <button className="btn-ghost !px-2 !py-1" onClick={() => shift(-1)} aria-label="Previous month">&larr;</button>
          <h2 className="font-semibold w-36 text-center">{first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h2>
          <button className="btn-ghost !px-2 !py-1" onClick={() => shift(1)} aria-label="Next month">&rarr;</button>
        </div>
        <button className="text-xs text-ink-faint hover:text-ink" onClick={() => setOpen(!open)}>{open ? "Hide calendar" : "Show calendar"}</button>
      </div>

      {open && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
          <div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint mb-1">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const info = days[d];
                const ccy = info && Object.keys(info.net)[0];
                return (
                  <button key={d} onClick={() => onSelect(d)} title={info?.goal || undefined}
                    className={`h-[4.5rem] rounded-lg border text-left px-1.5 py-1 flex flex-col transition ${
                      d === selected ? "border-accent ring-1 ring-accent" : "border-card-border hover:bg-card-hover"} ${
                      info?.has_card ? "bg-card-hover/60" : ""}`}>
                    <span className="flex items-center justify-between w-full">
                      <span className={`text-[11px] ${d === today ? "text-accent-soft font-semibold" : "text-ink-faint"}`}>{Number(d.slice(8))}</span>
                      {info?.goal_result && <span className={`w-1.5 h-1.5 rounded-full ${RESULT_DOT[info.goal_result]}`} />}
                    </span>
                    {info?.grade && <span className={`badge !px-1.5 self-start mt-0.5 font-semibold ${gradeTone(info.grade)}`}>{info.grade}</span>}
                    {ccy && (
                      <span className="mt-auto flex flex-col leading-tight">
                        {Object.entries(info.net).map(([c, v]) => (
                          <span key={c} className={`text-[10px] font-mono ${v >= 0 ? "text-pos" : "text-neg"}`}>{compact(v, c)}</span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 text-[11px] text-ink-faint mt-2">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-pos" /> goal hit</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-warn" /> partly</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-neg" /> missed</span>
            </div>
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">Goal hit this month</div>
              {stats?.goal.rated ? (
                <div>
                  <span className="text-2xl font-semibold font-mono">{stats.goal.hit_rate}%</span>
                  <span className="text-xs text-ink-muted ml-2">{stats.goal.hit} hit · {stats.goal.partly} partly · {stats.goal.missed} missed</span>
                </div>
              ) : <p className="text-xs text-ink-faint">Mark each day's goal as hit / partly / missed.</p>}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">Average grade by segment</div>
              {stats?.segments.length ? (
                <ul className="space-y-1">
                  {[...stats.segments].sort((a, b) => a.avg - b.avg).map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink-muted">{s.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-ink-faint">{s.days}d</span>
                        <span className={`badge font-semibold ${gradeTone(s.grade)}`}>{s.grade}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-ink-faint">Grade the segments in the table to see your weakest time of day.</p>}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">Day grade vs P&amp;L (avg per day)</div>
              {stats?.grades.length ? (
                <ul className="space-y-1">
                  {stats.grades.map((g) => (
                    <li key={g.grade} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className={`badge font-semibold ${gradeTone(g.grade)}`}>{g.grade}</span>
                        <span className="text-[11px] text-ink-faint">{g.days} day{g.days === 1 ? "" : "s"}</span>
                      </span>
                      <span className="font-mono text-xs">
                        {Object.entries(g.avg_net).length
                          ? Object.entries(g.avg_net).map(([c, v]) => (
                            <span key={c} className={`ml-2 ${v >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(v, c)}</span>))
                          : <span className="text-ink-faint">no trades</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-ink-faint">Grade your days to see if good process pays.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
