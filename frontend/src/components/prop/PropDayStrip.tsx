import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, PropAccountStatus } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { LEVEL_TEXT, lossLevel, StatusBadge } from "./PropBits";

/** Trading Day: how much the selected prop account can still lose today. */
export default function PropDayStrip({ accountId, refreshKey }: { accountId: number; refreshKey: unknown }) {
  const [d, setD] = useState<PropAccountStatus | null>(null);
  useEffect(() => {
    let live = true;
    api.propAccount(accountId).then((r) => live && setD(r)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [accountId, refreshKey]);
  if (!d) return null;
  const { account: a, status: s } = d;
  const m = (v: number | null) => formatMoney(v, a.currency);
  const lvl = lossLevel(s.rules);
  return (
    <div className="card px-4 py-2.5 mb-4 flex items-center gap-x-6 gap-y-1 flex-wrap text-sm">
      <span className="flex items-center gap-2">
        <Link to={`/prop/${a.id}`} className="font-medium hover:text-accent-soft">{a.name}</Link>
        <StatusBadge status={s.status} />
      </span>
      {s.can_lose_today != null && (
        <span>
          <span className="text-ink-faint">Can lose today </span>
          <span className={`font-mono font-semibold ${LEVEL_TEXT[lvl]}`}>{m(s.can_lose_today)}</span>
        </span>
      )}
      {s.daily_left != null && (
        <span><span className="text-ink-faint">Daily limit left </span><span className="font-mono">{m(s.daily_left)}</span></span>
      )}
      {s.floor != null && (
        <span><span className="text-ink-faint">Floor </span><span className="font-mono">{m(s.floor)}</span>
          <span className="text-ink-faint"> ({m(s.distance_to_floor)} away)</span></span>
      )}
      {s.target != null && (
        <span><span className="text-ink-faint">To target </span><span className="font-mono">{m(s.target_remaining)}</span></span>
      )}
      <span className="text-[11px] text-ink-faint ml-auto">as of trading day {s.today}</span>
    </div>
  );
}
