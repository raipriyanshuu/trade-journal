import { useState } from "react";
import { api } from "../../lib/api";

/** ☆ / ★ toggle: starred trades go to the Review view in the Trade Log. */
export default function StarButton({ tradeId, starred, onChange, big }: {
  tradeId: number; starred: boolean; onChange?: (starred: boolean) => void; big?: boolean;
}) {
  const [on, setOn] = useState(starred);
  const [busy, setBusy] = useState(false);
  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await api.updateTrade(tradeId, { starred: next });
      onChange?.(next);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={toggle} aria-pressed={on}
      aria-label={on ? "Remove from review" : "Star for review"} title={on ? "Starred for review (click to remove)" : "Star for review"}
      className={`leading-none transition-colors ${big ? "text-2xl" : "text-base"} ${on ? "text-amber-400" : "text-ink-faint hover:text-amber-400"}`}>
      {on ? "★" : "☆"}
    </button>
  );
}
