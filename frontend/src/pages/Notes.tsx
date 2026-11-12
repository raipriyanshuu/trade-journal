import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, AttachmentRow, Note, NoteType, ReviewDue, Shape } from "../lib/api";
import { useReference } from "../lib/useReference";
import Lightbox from "../components/Lightbox";
import Modal from "../components/Modal";
import Markdown from "../components/Markdown";
import { AnnotatedImage } from "../components/annotate/Annotations";

const TYPES: { key: NoteType; label: string; tone: string; dot: string }[] = [
  { key: "mistake", label: "Mistake", tone: "bg-neg/15 text-neg", dot: "bg-neg" },
  { key: "lesson", label: "Lesson", tone: "bg-pos/15 text-pos", dot: "bg-pos" },
  { key: "idea", label: "Idea", tone: "bg-accent/15 text-accent-soft", dot: "bg-accent" },
  { key: "observation", label: "Observation", tone: "bg-warn/15 text-warn", dot: "bg-warn" },
  { key: "note", label: "Note", tone: "bg-card-border text-ink-muted", dot: "bg-ink-faint" },
];
const typeOf = (k: string) => TYPES.find((t) => t.key === k) ?? TYPES[4];
const REVIEW_DEFAULT: Record<NoteType, boolean> = { mistake: true, lesson: true, idea: false, observation: false, note: false };
const BODY_HINT = "What was happening? What did I do? What should I have done? What's the lesson?";

const src = (a: AttachmentRow) => `/attachments/${a.file_path}`;
const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function imagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith("image/"))
    .map((i) => i.getAsFile()).filter((f): f is File => !!f);
}

/** Notes: a review deck of your lessons on top, a pinboard of everything below. */
export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [review, setReview] = useState<ReviewDue | null>(null);
  const [filter, setFilter] = useState<NoteType | "all" | "pinned" | "review">("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Note | null>(null);
  const [viewer, setViewer] = useState<{ images: AttachmentRow[]; index: number } | null>(null);

  const load = useCallback(() => {
    const params = filter === "pinned" ? { pinned: true } : filter === "review" ? { in_review: true }
      : filter === "all" ? {} : { note_type: filter };
    return api.listNotes({ ...params, q: q.trim() || undefined }).then(setNotes).finally(() => setLoading(false));
  }, [filter, q]);
  const loadReview = useCallback(() => api.reviewDue().then(setReview).catch(() => {}), []);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { loadReview(); }, [loadReview]);

  function replace(n: Note) {
    setNotes((list) => list.map((x) => (x.id === n.id ? n : x)));
    setEditing((e) => (e && e.id === n.id ? n : e));
  }
  function patchAttachment(id: number, shapes: Shape[]) {
    const fix = (n: Note) => ({ ...n, attachments: n.attachments.map((a) => (a.id === id ? { ...a, annotations: shapes } : a)) });
    setNotes((list) => list.map(fix));
    setEditing((e) => (e ? fix(e) : e));
    setReview((r) => (r ? { ...r, due: r.due.map(fix) } : r));
    setViewer((v) => (v ? { ...v, images: v.images.map((a) => (a.id === id ? { ...a, annotations: shapes } : a)) } : v));
  }
  async function togglePin(n: Note) {
    replace(await api.updateNote(n.id, { pinned: !n.pinned }));
    load();
  }

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Notes</h1>
          <p className="text-sm text-ink-muted">Ideas, mistakes and lessons with your chart screenshots. Lessons come back for review so they stick.</p>
        </div>
      </div>

      <ReviewDeck data={review} onReviewed={() => { loadReview(); load(); }}
        onOpenImages={(images, index) => setViewer({ images, index })} onEdit={setEditing} />

      <QuickCapture onCreated={() => { load(); loadReview(); }} paused={!!editing || !!viewer} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {([["all", "All"], ...TYPES.map((t) => [t.key, t.label + "s"]), ["pinned", "Pinned"], ["review", "In review"]] as [string, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k as typeof filter)}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${filter === k ? "bg-accent/20 text-ink border-accent/50" : "border-card-border text-ink-muted hover:text-ink"}`}>
            {l === "Notes" ? "Notes" : l}
          </button>
        ))}
        <input className="input !w-56 !py-1 text-sm ml-auto" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading&hellip;</p> : notes.length === 0 ? (
        <div className="card p-10 text-center text-ink-muted text-sm">
          {q || filter !== "all" ? "No notes match." : "No notes yet. Write your first one above, and paste a chart screenshot with Ctrl+V."}
        </div>
      ) : (
        <div className="columns-1 md:columns-2 xl:columns-3 gap-4">
          {notes.map((n) => (
            <NoteCard key={n.id} n={n} onEdit={() => setEditing(n)} onPin={() => togglePin(n)}
              onOpenImage={(i) => setViewer({ images: n.attachments, index: i })} />
          ))}
        </div>
      )}

      {editing && (
        <NoteEditor note={editing} onClose={() => { setEditing(null); load(); loadReview(); }}
          onChange={replace} onDeleted={() => { setEditing(null); load(); loadReview(); }}
          onOpenImage={(i) => setViewer({ images: editing.attachments, index: i })} />
      )}
      {viewer && viewer.images[viewer.index] && (
        <Lightbox images={viewer.images.map((a) => ({ src: src(a), name: a.original_name, id: a.id, annotations: a.annotations }))}
          index={viewer.index} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)}
          onAnnotationsSaved={patchAttachment} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- review deck */

function ReviewDeck({ data, onReviewed, onOpenImages, onEdit }: {
  data: ReviewDue | null;
  onReviewed: () => void;
  onOpenImages: (images: AttachmentRow[], index: number) => void;
  onEdit: (n: Note) => void;
}) {
  const [pos, setPos] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [showBody, setShowBody] = useState(false);
  useEffect(() => { setPos(0); setShowBody(false); }, [data?.due.length]);
  if (!data) return null;
  const s = data.stats;
  const card = data.due[pos];

  async function answer(result: "got_it" | "again") {
    if (!card) return;
    setBusy(true);
    try {
      await api.reviewNote(card.id, result);
      setDone((d) => d + 1);
      setShowBody(false);
      onReviewed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 mb-4">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-ink-faint">Pre-market review</div>
          {card && <div className="text-xs text-ink-faint">{s.due} due{done ? ` · ${done} done` : ""}</div>}
        </div>
        {!card ? (
          <div className="text-center py-6">
            <div className="text-lg font-semibold">{s.in_deck ? "All caught up" : "Your review deck is empty"}</div>
            <p className="text-sm text-ink-muted mt-1">
              {s.in_deck
                ? `${s.next_due ? `Next lesson comes back on ${pretty(s.next_due)}.` : ""} Read your lessons before the open; each "Got it" brings a card back later.`
                : "Lessons and mistakes you write join the deck automatically. You can add any note from its menu."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_minmax(0,0.9fr)] gap-4 items-start">
            <div>
              <span className={`badge ${typeOf(card.note_type).tone}`}>{typeOf(card.note_type).label}</span>
              {card.symbol && <span className="badge bg-card-hover text-ink-muted ml-1">{card.symbol}</span>}
              <h2 className="text-xl font-semibold mt-2">{card.title}</h2>
              {card.body && (showBody ? (
                <div className="text-sm text-ink-muted mt-2"><Markdown text={card.body} /></div>
              ) : (
                <button className="text-xs text-accent-soft hover:underline mt-2" onClick={() => setShowBody(true)}>Show the full note</button>
              ))}
              <div className="flex gap-2 mt-4">
                <button className="btn-ghost" disabled={busy} onClick={() => answer("again")}>Still learning</button>
                <button className="btn-primary" disabled={busy} onClick={() => answer("got_it")}>Got it</button>
                <button className="text-xs text-ink-faint hover:text-ink ml-auto" onClick={() => onEdit(card)}>Edit</button>
              </div>
              <p className="text-[11px] text-ink-faint mt-2">
                Seen {card.times_reviewed}× · {card.mastered ? "mastered" : `level ${card.review_box + 1} of 5`}
              </p>
            </div>
            {card.attachments[0] && (
              <AnnotatedImage src={src(card.attachments[0])} shapes={card.attachments[0].annotations}
                className="cursor-zoom-in rounded-lg border border-card-border overflow-hidden"
                onClick={() => onOpenImages(card.attachments, 0)} />
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
        <Stat label="Due today" value={s.due} cls={s.due ? "text-warn" : ""} />
        <Stat label="In review deck" value={s.in_deck} />
        <Stat label="Mastered" value={s.mastered} cls="text-pos" />
        <Stat label="Still learning" value={s.learning} />
      </div>
    </div>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: number; cls?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-xl font-semibold font-mono ${cls}`}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------- quick capture */

function TypePicker({ value, onChange }: { value: NoteType; onChange: (t: NoteType) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TYPES.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`badge transition ${value === t.key ? `${t.tone} ring-1 ring-current` : "bg-card-hover text-ink-faint hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function QuickCapture({ onCreated, paused }: { onCreated: () => void; paused: boolean }) {
  const { instruments } = useReference({ allBooks: true });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<NoteType>("lesson");
  const [instrumentId, setInstrumentId] = useState<number | "">("");
  const [inReview, setInReview] = useState(true);
  const [reviewTouched, setReviewTouched] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // Paste a screenshot anywhere on the page (unless the editor or viewer is open).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (pausedRef.current) return;
      const imgs = imagesFromClipboard(e);
      if (imgs.length) { e.preventDefault(); setFiles((f) => [...f, ...imgs]); }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function pickType(t: NoteType) {
    setType(t);
    if (!reviewTouched) setInReview(REVIEW_DEFAULT[t]);
  }

  async function save() {
    if (!title.trim() && !body.trim() && files.length === 0) return setErr("Write something or paste a screenshot first.");
    setBusy(true);
    setErr(null);
    try {
      const n = await api.createNote({
        title, body, note_type: type, in_review: inReview,
        instrument_id: instrumentId === "" ? null : instrumentId,
      });
      for (const f of files) await api.uploadNoteAttachment(n.id, f, f.name || "paste.png");
      setTitle(""); setBody(""); setFiles([]); setReviewTouched(false); setInReview(REVIEW_DEFAULT[type]);
      onCreated();
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-5" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <TypePicker value={type} onChange={pickType} />
        <select className="input !w-auto !py-1 text-xs ml-auto" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Any instrument</option>
          {instruments.map((i) => <option key={i.id} value={i.id}>{i.symbol_root}</option>)}
        </select>
      </div>
      <input className="input mb-2 font-medium" placeholder="Title (e.g. No volume = no breakout)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input min-h-[84px] text-sm" placeholder={`${BODY_HINT}\nPaste a chart screenshot with Ctrl+V.`} value={body} onChange={(e) => setBody(e.target.value)} />
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {previews.map((u, i) => (
            <div key={u} className="relative group">
              <img src={u} alt="" className="h-20 rounded-lg border border-card-border" />
              <button className="absolute top-1 right-1 bg-black/70 text-white rounded px-1.5 text-xs opacity-0 group-hover:opacity-100"
                onClick={() => setFiles((f) => f.filter((_, j) => j !== i))} aria-label="Remove screenshot">&times;</button>
            </div>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-neg mt-2">{err}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <label className="btn-ghost text-xs cursor-pointer !py-1">
          + Screenshot
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={inReview} onChange={(e) => { setInReview(e.target.checked); setReviewTouched(true); }} />
          Add to review deck
        </label>
        <span className="text-[11px] text-ink-faint ml-auto">Ctrl+Enter to save · draw on screenshots after saving</span>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save note"}</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- pinboard card */

function NoteCard({ n, onEdit, onPin, onOpenImage }: {
  n: Note; onEdit: () => void; onPin: () => void; onOpenImage: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = typeOf(n.note_type);
  const long = n.body.length > 280 || n.body.split("\n").length > 6;
  return (
    <div className={`card mb-4 break-inside-avoid overflow-hidden ${n.pinned ? "ring-1 ring-warn/50" : ""}`}>
      {n.attachments[0] && (
        <div className="relative">
          <AnnotatedImage src={src(n.attachments[0])} shapes={n.attachments[0].annotations}
            className="cursor-zoom-in [&_img]:rounded-none" onClick={() => onOpenImage(0)} />
          {n.attachments.length > 1 && (
            <button className="absolute bottom-2 right-2 badge bg-black/70 text-white" onClick={() => onOpenImage(1)}>+{n.attachments.length - 1}</button>
          )}
        </div>
      )}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug cursor-pointer hover:text-accent-soft" onClick={onEdit}>{n.title || t.label}</h3>
          <button className={`text-sm leading-none ${n.pinned ? "text-warn" : "text-ink-faint hover:text-ink"}`} title={n.pinned ? "Unpin" : "Pin"} onClick={onPin}>
            {n.pinned ? "★" : "☆"}
          </button>
        </div>
        {n.body && (
          <div className={`text-sm text-ink-muted mt-1.5 ${!open && long ? "max-h-36 overflow-hidden relative" : ""}`}>
            <Markdown text={n.body} />
            {!open && long && <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-card to-transparent" />}
          </div>
        )}
        {long && <button className="text-xs text-accent-soft hover:underline mt-1" onClick={() => setOpen((o) => !o)}>{open ? "Show less" : "Read more"}</button>}
        <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[11px]">
          <span className={`badge ${t.tone}`}>{t.label}</span>
          {n.symbol && <span className="badge bg-card-hover text-ink-muted">{n.symbol}</span>}
          {n.trade_id && <Link to={`/trades/${n.trade_id}`} className="badge bg-card-hover text-accent-soft">trade #{n.trade_id}</Link>}
          {n.in_review && (
            <span className={`badge ${n.mastered ? "bg-pos/15 text-pos" : "bg-card-hover text-ink-faint"}`} title="Review deck">
              {n.mastered ? "mastered" : `review · lvl ${n.review_box + 1}`}
            </span>
          )}
          <span className="text-ink-faint ml-auto">{pretty(n.note_date)}</span>
          <button className="text-ink-faint hover:text-ink" onClick={onEdit}>Edit</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- note editor */

function NoteEditor({ note, onClose, onChange, onDeleted, onOpenImage }: {
  note: Note; onClose: () => void; onChange: (n: Note) => void; onDeleted: () => void; onOpenImage: (i: number) => void;
}) {
  const { instruments } = useReference({ allBooks: true });
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(p: Partial<Note>) {
    setErr(null);
    try { onChange(await api.updateNote(note.id, p)); } catch (e) { setErr((e as Error).message.replace(/^\d+:\s*/, "")); }
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      for (const f of files) await api.uploadNoteAttachment(note.id, f, f.name || "paste.png");
      onChange((await api.listNotes()).find((x) => x.id === note.id) ?? note);
    } finally {
      setBusy(false);
    }
  }
  async function removeShot(a: AttachmentRow) {
    if (!confirm("Delete this screenshot? This can't be undone.")) return;
    await api.deleteAttachment(a.id);
    onChange({ ...note, attachments: note.attachments.filter((x) => x.id !== a.id) });
  }
  async function saveAndClose() {
    if (title !== note.title || body !== note.body) await patch({ title, body });
    onClose();
  }
  async function remove() {
    if (!confirm("Delete this note and its screenshots? This can't be undone.")) return;
    await api.deleteNote(note.id);
    onDeleted();
  }

  return (
    <Modal wide title="Edit note" open onClose={saveAndClose} footer={
      <>
        <button className="btn-ghost text-neg mr-auto" onClick={remove}>Delete note</button>
        <button className="btn-primary" onClick={saveAndClose}>Done</button>
      </>
    }>
      <div onPaste={(e) => { const imgs = imagesFromClipboard(e); if (imgs.length) { e.preventDefault(); upload(imgs); } }}>
        {err && <p className="text-neg text-sm mb-2">{err}</p>}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <TypePicker value={note.note_type} onChange={(t) => patch({ note_type: t })} />
          <select className="input !w-auto !py-1 text-xs" value={note.instrument_id ?? ""}
            onChange={(e) => patch({ instrument_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Any instrument</option>
            {instruments.map((i) => <option key={i.id} value={i.id}>{i.symbol_root}</option>)}
          </select>
          <input type="date" className="input !w-auto !py-1 text-xs" value={note.note_date} onChange={(e) => e.target.value && patch({ note_date: e.target.value })} />
          <label className="flex items-center gap-1.5 text-xs text-ink-muted ml-auto">
            <input type="checkbox" checked={note.pinned} onChange={(e) => patch({ pinned: e.target.checked })} /> Pinned
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" checked={note.in_review} onChange={(e) => patch({ in_review: e.target.checked })} /> In review deck
          </label>
        </div>
        <input className="input mb-2 text-base font-semibold" value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== note.title && patch({ title })} />
        <textarea className="input min-h-[180px] text-sm" value={body} placeholder={BODY_HINT} onChange={(e) => setBody(e.target.value)}
          onBlur={() => body !== note.body && patch({ body })} />
        <p className="text-[11px] text-ink-faint mt-1">Tip: start lines with "- " for bullets, wrap words in **double stars** for bold.</p>

        <div className="flex items-center justify-between mt-4 mb-2">
          <h4 className="text-sm font-medium">Screenshots</h4>
          <label className="btn-ghost text-xs cursor-pointer !py-1">
            {busy ? "Uploading…" : "+ Add"}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </label>
        </div>
        {note.attachments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-card-border p-5 text-center text-sm text-ink-faint">Paste a chart screenshot here (Ctrl+V).</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {note.attachments.map((a, i) => (
              <div key={a.id} className="relative group">
                <AnnotatedImage src={src(a)} shapes={a.annotations} className="cursor-zoom-in rounded-lg border border-card-border overflow-hidden"
                  onClick={() => onOpenImage(i)} />
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100">
                  <button className="bg-black/70 text-white rounded px-1.5 text-xs" onClick={() => onOpenImage(i)}>&#9998; Draw</button>
                  <button className="bg-black/70 text-white rounded px-1.5 text-xs" onClick={() => removeShot(a)} aria-label="Delete screenshot">&times;</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
