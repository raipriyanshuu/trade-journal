import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import AnalyticsFilterBar, { AnalyticsFilters } from "../components/AnalyticsFilterBar";
import { formatMoney } from "../lib/format";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad(n: number) { return String(n).padStart(2, "0"); }

export default function Calendar() {
  const nav = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [filters, setFilters] = useState<AnalyticsFilters>({ include_demo: true });
  const [data, setData] = useState<Record<string, { net: number; trades: number; win_rate: number }>>({});

  useEffect(() => { api.calendar(filters as any).then(setData); }, [JSON.stringify(filters)]);

  const ccy = filters.currency ?? "USD";

  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const offset = first.getDay();
    const daysIn = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const w: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
  }, [year, month]);

  function cellData(day: number | null) {
    if (!day) return null;
    return data[`${year}-${pad(month + 1)}-${pad(day)}`] ?? null;
  }

  function weekTotal(week: (number | null)[]) {
    let net = 0, trades = 0, days = 0;
    for (const d of week) {
      const cd = cellData(d);
      if (cd) { net += cd.net; trades += cd.trades; days += 1; }
    }
    return { net, trades, days };
  }

  const monthNet = Object.entries(data)
    .filter(([k]) => k.startsWith(`${year}-${pad(month + 1)}`))
    .reduce((s, [, v]) => s + v.net, 0);

  function prev() { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); }
  function next() { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">P&amp;L Calendar</h1>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={prev}>&larr;</button>
          <span className="font-medium w-40 text-center">{MONTHS[month]} {year}</span>
          <button className="btn-ghost" onClick={next}>&rarr;</button>
          <span className={`font-mono ${monthNet >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(monthNet, ccy)}</span>
        </div>
      </div>
      <AnalyticsFilterBar filters={filters} onChange={setFilters} />

      <div className="card p-3 overflow-x-auto">
        <div className="grid grid-cols-[repeat(7,1fr)_1.1fr] gap-1.5 min-w-[720px]">
          {DOW.map((d) => <div key={d} className="text-center text-xs text-ink-faint py-1">{d}</div>)}
          <div className="text-center text-xs text-ink-faint py-1">Week</div>

          {weeks.map((week, wi) => {
            const wt = weekTotal(week);
            return (
              <FragmentWeek key={wi}>
                {week.map((day, di) => {
                  const cd = cellData(day);
                  const bg = !cd ? "bg-bg-soft" : cd.net > 0 ? "bg-pos/15" : cd.net < 0 ? "bg-neg/15" : "bg-card-hover";
                  return (
                    <div key={di}
                      className={`rounded-lg h-20 p-1.5 ${day ? bg : "opacity-30"} ${cd ? "cursor-pointer hover:ring-1 hover:ring-accent/50" : ""}`}
                      onClick={() => cd && nav(`/journal?date=${year}-${pad(month + 1)}-${pad(day!)}${filters.account_id ? `&account=${filters.account_id}` : ""}`)}>
                      {day && <div className="text-xs text-ink-faint">{day}</div>}
                      {cd && (
                        <div className="mt-1">
                          <div className={`font-mono text-xs font-semibold ${cd.net >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(cd.net, ccy)}</div>
                          <div className="text-[10px] text-ink-faint">{cd.trades} {cd.trades === 1 ? "trade" : "trades"}</div>
                          <div className="text-[10px] text-ink-faint">{Math.round(cd.win_rate * 100)}%</div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="rounded-lg h-20 p-1.5 bg-card-hover flex flex-col justify-center">
                  <div className={`font-mono text-sm font-semibold ${wt.net >= 0 ? "text-pos" : "text-neg"}`}>{formatMoney(wt.net, ccy)}</div>
                  <div className="text-[10px] text-ink-faint">{wt.days} days &middot; {wt.trades} trades</div>
                </div>
              </FragmentWeek>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FragmentWeek({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
