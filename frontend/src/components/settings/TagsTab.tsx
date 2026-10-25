import { useEffect, useState } from "react";
import { api, Tag } from "../../lib/api";
import { styleTone, useStyles } from "../../lib/useStyles";

const CATEGORIES = ["setup", "mistake", "emotion", "custom"];

export default function TagsTab() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("setup");
  const [mergeFrom, setMergeFrom] = useState<number | "">("");
  const [mergeInto, setMergeInto] = useState<number | "">("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  function load() {
    api.listTags(true).then(setTags);
  }
  useEffect(load, []);

  async function create() {
    if (!newName) return;
    await api.createTag(newName, newCat);
    setNewName("");
    load();
  }
  async function rename(id: number) {
    await api.updateTag(id, { name: editName });
    setEditingId(null);
    load();
  }
  async function toggleArchive(t: Tag & { archived?: boolean }) {
    await api.updateTag(t.id, { archived: !(t as { archived?: boolean }).archived });
    load();
  }
  async function remove(id: number) {
    if (!confirm("Delete this tag? It is removed from all trades.")) return;
    await api.deleteTag(id);
    load();
  }
  async function doMerge() {
    if (!mergeFrom || !mergeInto || mergeFrom === mergeInto) return;
    await api.mergeTags(Number(mergeFrom), Number(mergeInto));
    setMergeFrom("");
    setMergeInto("");
    load();
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <StylesEditor />
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">New tag</label>
          <input className="input !w-48" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name" />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input !w-auto" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={create}>Add tag</button>
      </div>

      {CATEGORIES.map((cat) => {
        const rows = tags.filter((t) => t.category === cat);
        if (rows.length === 0) return null;
        return (
          <div key={cat} className="card p-4">
            <h3 className="font-medium text-sm mb-2 capitalize">{cat}</h3>
            <div className="flex flex-wrap gap-2">
              {rows.map((t) => {
                const archived = (t as { archived?: boolean }).archived;
                return (
                  <div key={t.id} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-sm ${archived ? "bg-bg-soft text-ink-faint" : "bg-card-hover"}`}>
                    {editingId === t.id ? (
                      <input className="input !w-32 !py-0.5" value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && rename(t.id)} autoFocus />
                    ) : (
                      <span onClick={() => { setEditingId(t.id); setEditName(t.name); }} className="cursor-pointer">{t.name}</span>
                    )}
                    <button className="text-ink-faint hover:text-warn text-xs" onClick={() => toggleArchive(t)} title={archived ? "Unarchive" : "Archive"}>
                      {archived ? "↺" : "⚑"}
                    </button>
                    <button className="text-ink-faint hover:text-neg text-xs" onClick={() => remove(t.id)}>&times;</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="card p-4">
        <h3 className="font-medium text-sm mb-2">Merge tags</h3>
        <div className="flex items-end gap-2">
          <div>
            <label className="label">From</label>
            <select className="input !w-auto" value={mergeFrom} onChange={(e) => setMergeFrom(Number(e.target.value))}>
              <option value="">&mdash;</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
            </select>
          </div>
          <span className="text-ink-faint pb-2">&rarr;</span>
          <div>
            <label className="label">Into</label>
            <select className="input !w-auto" value={mergeInto} onChange={(e) => setMergeInto(Number(e.target.value))}>
              <option value="">&mdash;</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
            </select>
          </div>
          <button className="btn-ghost" onClick={doMerge}>Merge</button>
        </div>
        <p className="text-xs text-ink-faint mt-2">All trades on "From" move to "Into", then "From" is deleted.</p>
      </div>
    </div>
  );
}

/** Trade styles (Scalp / Swing / ...). Removing one here leaves trades that use it untouched. */
function StylesEditor() {
  const { styles, save } = useStyles();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function persist(next: string[]) {
    setErr(null);
    try { await save(next); } catch (e) { setErr((e as Error).message); }
  }
  function add() {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (styles.some((s) => s.toLowerCase() === clean.toLowerCase())) { setErr(`"${clean}" already exists`); return; }
    persist([...styles, clean]).then(() => setName(""));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= styles.length) return;
    const next = [...styles];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  }
  function remove(s: string) {
    if (!confirm(`Remove "${s}" from the style list? Trades already marked ${s} keep it.`)) return;
    persist(styles.filter((x) => x !== s));
  }

  return (
    <div className="card p-4">
      <h3 className="font-medium text-sm mb-1">Trade styles</h3>
      <p className="text-xs text-ink-faint mb-3">
        Pick one per trade (Scalp, Swing&hellip;). The dashboard, analytics and reports can be filtered by style.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        {styles.map((s, i) => (
          <span key={s} className={`badge inline-flex items-center gap-1 ${styleTone(s)}`}>
            <button className="opacity-60 hover:opacity-100" title="Move left" onClick={() => move(i, -1)}>&lsaquo;</button>
            {s}
            <button className="opacity-60 hover:opacity-100" title="Move right" onClick={() => move(i, 1)}>&rsaquo;</button>
            <button className="opacity-60 hover:opacity-100 hover:text-neg ml-0.5" title="Remove" onClick={() => remove(s)}>&times;</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input !w-48" placeholder="new style, e.g. Overnight" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-ghost" onClick={add} disabled={!name.trim()}>Add style</button>
      </div>
      {err && <p className="text-xs text-neg mt-1">{err}</p>}
    </div>
  );
}
