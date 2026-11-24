import { useEffect, useState } from "react";
import { api, ReportCardConfig } from "../../lib/api";

/** Default segments, table columns and standing reminders for the Daily Report Card. */
export default function ReportCardTab() {
  const [cfg, setCfg] = useState<ReportCardConfig | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setCfg((s.report_card as ReportCardConfig) ?? { segments: [], columns: [], reminders: [] }));
  }, []);
  if (!cfg) return <p className="text-ink-muted text-sm">Loading…</p>;

  const set = (patch: Partial<ReportCardConfig>) => { setCfg({ ...cfg, ...patch }); setSaved(null); };
  const move = <T,>(list: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  async function save() {
    const clean: ReportCardConfig = {
      segments: cfg!.segments.map((s) => s.trim()).filter(Boolean),
      columns: cfg!.columns.filter((c) => c.name.trim()).map((c) => ({
        name: c.name.trim(), options: c.options.map((o) => o.trim()).filter(Boolean),
      })),
      reminders: cfg!.reminders.map((r) => r.trim()).filter(Boolean),
    };
    try {
      await api.updateSettings({ report_card: clean });
      setCfg(clean);
      setSaved("Saved. New report cards use these; cards you already wrote keep their rows.");
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <p className="text-sm text-ink-muted">
        What a new Daily Report Card starts with. You can still add or remove rows on any single day.
      </p>

      <div className="card p-4">
        <h3 className="font-semibold mb-1">Segments (rows)</h3>
        <p className="text-xs text-ink-faint mb-3">Parts of your day you grade separately, e.g. by session time in IST.</p>
        <ListEditor items={cfg.segments} placeholder="US open 19:00-20:30"
          onChange={(segments) => set({ segments })} move={move} />
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-1">Columns</h3>
        <p className="text-xs text-ink-faint mb-3">
          Grade and Comments are always there. For each extra column, list the choices separated by commas,
          or leave them empty for a free-text column.
        </p>
        <div className="space-y-2">
          {cfg.columns.map((c, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input className="input !w-48" value={c.name} placeholder="Column name" aria-label="Column name"
                onChange={(e) => set({ columns: cfg.columns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className="input" value={c.options.join(",")} placeholder="Yes, No" aria-label={`${c.name} choices`}
                onChange={(e) => set({ columns: cfg.columns.map((x, j) => (j === i ? { ...x, options: e.target.value.split(",") } : x)) })} />
              <Arrows onUp={() => set({ columns: move(cfg.columns, i, -1) })} onDown={() => set({ columns: move(cfg.columns, i, 1) })} />
              <button className="text-ink-faint hover:text-neg text-sm" aria-label={`Remove ${c.name}`}
                onClick={() => set({ columns: cfg.columns.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>
        <button className="btn-ghost mt-2 !py-1 text-xs" onClick={() => set({ columns: [...cfg.columns, { name: "", options: [] }] })}>+ Column</button>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-1">Standing reminders</h3>
        <p className="text-xs text-ink-faint mb-3">Shown at the top of every day's card.</p>
        <ListEditor items={cfg.reminders} placeholder="Only A+ setups in the first hour"
          onChange={(reminders) => set({ reminders })} move={move} />
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save}>Save</button>
        {saved && <span className="text-xs text-pos">{saved}</span>}
        {err && <span className="text-xs text-neg">{err}</span>}
      </div>
    </div>
  );
}

function ListEditor({ items, placeholder, onChange, move }: {
  items: string[]; placeholder: string; onChange: (v: string[]) => void;
  move: <T>(list: T[], i: number, d: number) => T[];
}) {
  return (
    <div className="space-y-2">
      {items.map((s, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input className="input" value={s} placeholder={placeholder} aria-label={`Item ${i + 1}`}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <Arrows onUp={() => onChange(move(items, i, -1))} onDown={() => onChange(move(items, i, 1))} />
          <button className="text-ink-faint hover:text-neg text-sm" aria-label={`Remove ${s}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn-ghost !py-1 text-xs" onClick={() => onChange([...items, ""])}>+ Add</button>
    </div>
  );
}

function Arrows({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  return (
    <span className="flex flex-col leading-none">
      <button className="text-ink-faint hover:text-ink text-[10px]" onClick={onUp} aria-label="Move up">▲</button>
      <button className="text-ink-faint hover:text-ink text-[10px]" onClick={onDown} aria-label="Move down">▼</button>
    </span>
  );
}
