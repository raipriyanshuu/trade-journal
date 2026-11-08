import { useEffect, useRef, useState } from "react";
import { api, AttachmentRow } from "../../lib/api";
import Lightbox from "../Lightbox";

/**
 * Chart screenshots for a trading day (e.g. your marked levels before the open).
 * Upload, or paste with Ctrl+V while this card is on screen. The day is saved
 * first if it hasn't been yet, so the pictures have something to attach to.
 */
export default function DayScreenshots({ sessionId, ensureSession, title = "Pre-market charts", hint }: {
  sessionId: number | null | undefined;
  ensureSession: () => Promise<number>;
  title?: string;
  hint?: string;
}) {
  const [items, setItems] = useState<AttachmentRow[]>([]);
  const [viewer, setViewer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Always use the page's current day/instrument when saving (the paste listener
  // outlives renders, so it must not hold on to an old ensureSession).
  const latest = useRef({ sessionId, ensureSession });
  latest.current = { sessionId, ensureSession };

  useEffect(() => {
    if (!sessionId) { setItems([]); return; }
    api.listJournalAttachments(sessionId).then(setItems).catch(() => setItems([]));
  }, [sessionId]);

  async function upload(files: (File | Blob)[]) {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const sid = latest.current.sessionId ?? (await latest.current.ensureSession());
      for (const f of files) await api.uploadJournalAttachment(sid, f, f instanceof File ? f.name : "paste.png");
      setItems(await api.listJournalAttachments(sid));
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  // Paste an image anywhere on the page while this card is mounted.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const imgs = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (imgs.length) { e.preventDefault(); upload(imgs); }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function remove(a: AttachmentRow) {
    if (!confirm("Delete this screenshot? This can't be undone.")) return;
    await api.deleteAttachment(a.id);
    setItems((x) => x.filter((i) => i.id !== a.id));
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-sm">{title}</h3>
        <label className="btn-ghost text-xs cursor-pointer !py-1">
          {busy ? "Uploading…" : "Upload"}
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </label>
      </div>
      <p className="text-xs text-ink-faint mb-2">{hint ?? "Mark your levels on the chart, then paste the screenshot here (Ctrl+V)."}</p>
      {err && <p className="text-xs text-neg mb-2">{err}</p>}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-card-border p-5 text-center text-sm text-ink-faint">No screenshots yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((a, i) => (
            <div key={a.id} className="relative group">
              <img src={`/attachments/${a.file_path}`} alt={a.original_name ?? "Chart screenshot"} title="Click to enlarge"
                className="w-full h-28 object-cover rounded-lg border border-card-border cursor-zoom-in hover:border-accent/60"
                onClick={() => setViewer(i)} />
              <button className="absolute top-1 right-1 bg-black/70 text-white rounded px-1.5 text-xs opacity-0 group-hover:opacity-100"
                title="Delete screenshot" onClick={() => remove(a)}>&times;</button>
            </div>
          ))}
        </div>
      )}
      {viewer !== null && items[viewer] && (
        <Lightbox images={items.map((a) => ({ src: `/attachments/${a.file_path}`, name: a.original_name }))}
          index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
