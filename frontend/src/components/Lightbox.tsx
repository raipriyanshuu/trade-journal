import { useEffect, useRef, useState } from "react";
import { api, Shape } from "../lib/api";
import { INK, ShapeView, sizeFor } from "./annotate/Annotations";

export interface LightboxImage {
  src: string;
  name?: string | null;
  id?: number; // attachment id: when set, the screenshot can be drawn on
  annotations?: Shape[] | null;
}

interface Props {
  images: LightboxImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onAnnotationsSaved?: (attachmentId: number, shapes: Shape[]) => void;
}

type Tool = Shape["type"] | "erase";
const TOOLS: { key: Tool; icon: string; label: string }[] = [
  { key: "pen", icon: "✎", label: "Pen" },
  { key: "line", icon: "╱", label: "Line" },
  { key: "arrow", icon: "↗", label: "Arrow" },
  { key: "box", icon: "▭", label: "Box" },
  { key: "circle", icon: "◯", label: "Circle" },
  { key: "text", icon: "T", label: "Text" },
  { key: "erase", icon: "⌫", label: "Eraser (click a drawing)" },
];
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Full-screen image viewer: Esc / click outside closes, arrow keys navigate.
 * Screenshots with an id can be drawn on (pen, line, arrow, box, circle, text);
 * drawings are saved as a separate layer, the image itself is never changed.
 */
export default function Lightbox({ images, index, onIndex, onClose, onAnnotationsSaved }: Props) {
  const count = images.length;
  const img = images[index];
  const [editing, setEditing] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>(img?.annotations ?? []);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(INK[0]);
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const svgRef = useRef<SVGSVGElement>(null);
  const pending = useRef<{ id: number; shapes: Shape[] } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // New image: load its drawings, leave edit mode.
  useEffect(() => {
    setShapes(img?.annotations ?? []);
    setEditing(false);
    setDraft(null);
    setTextDraft(null);
    setDims(null);
    setSaveState("");
  }, [index, img?.src]);

  function flush() {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    api.saveAnnotations(p.id, p.shapes)
      .then(() => { setSaveState("saved"); onAnnotationsSaved?.(p.id, p.shapes); })
      .catch(() => setSaveState("error"));
  }
  useEffect(() => () => flush(), []); // save anything pending when the viewer closes

  function commit(next: Shape[]) {
    setShapes(next);
    if (img?.id === undefined) return;
    pending.current = { id: img.id, shapes: next };
    setSaveState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 500);
  }

  function commitText() {
    if (!textDraft || !dims) return;
    const value = textDraft.value.trim();
    if (value) {
      commit([...shapes, { id: uid(), type: "text", x1: textDraft.x, y1: textDraft.y, text: value, color, size: sizeFor(dims.w, level, true) }]);
    }
    setTextDraft(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (textDraft) return; // typing text
      if (editing) {
        if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); commit(shapes.slice(0, -1)); }
        return;
      }
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && count > 1) onIndex((index + 1) % count);
      else if (e.key === "ArrowLeft" && count > 1) onIndex((index - 1 + count) % count);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // no page scroll behind the viewer
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, count, onIndex, onClose, editing, textDraft, shapes]);

  if (!img) return null;
  const canDraw = img.id !== undefined;

  function toImg(e: React.PointerEvent): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * dims!.w) / r.width, ((e.clientY - r.top) * dims!.h) / r.height];
  }
  function down(e: React.PointerEvent) {
    if (!editing || !dims || tool === "erase") return;
    e.preventDefault();
    const [x, y] = toImg(e);
    if (tool === "text") {
      if (textDraft) commitText();
      setTextDraft({ x, y, value: "" });
      return;
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* keep drawing without capture */ }
    const size = sizeFor(dims.w, level);
    setDraft(tool === "pen"
      ? { id: uid(), type: "pen", points: [[x, y]], color, size }
      : { id: uid(), type: tool, x1: x, y1: y, x2: x, y2: y, color, size });
  }
  function move(e: React.PointerEvent) {
    if (!draft) return;
    const [x, y] = toImg(e);
    if (draft.type === "pen") {
      const pts = draft.points ?? [];
      const [lx, ly] = pts[pts.length - 1];
      if (Math.hypot(x - lx, y - ly) >= draft.size / 2) setDraft({ ...draft, points: [...pts, [Math.round(x), Math.round(y)]] });
    } else {
      setDraft({ ...draft, x2: x, y2: y });
    }
  }
  function up() {
    if (!draft || !dims) return;
    const min = dims.w / 200;
    const ok = draft.type === "pen"
      ? (draft.points?.length ?? 0) > 1
      : Math.hypot((draft.x2 ?? 0) - (draft.x1 ?? 0), (draft.y2 ?? 0) - (draft.y1 ?? 0)) > min;
    if (ok) {
      const round = (v?: number) => (v === undefined ? v : Math.round(v));
      commit([...shapes, draft.type === "pen" ? draft : { ...draft, x1: round(draft.x1), y1: round(draft.y1), x2: round(draft.x2), y2: round(draft.y2) }]);
    }
    setDraft(null);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col" onClick={() => !editing && onClose()} role="dialog" aria-modal="true">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-ink-muted" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">{img.name || "Screenshot"}{count > 1 ? ` · ${index + 1} / ${count}` : ""}</span>
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex p-0.5 rounded-lg bg-white/10">
              {TOOLS.map((t) => (
                <button key={t.key} title={t.label} aria-label={t.label} onClick={() => setTool(t.key)}
                  className={`w-8 h-8 rounded-md text-base ${tool === t.key ? "bg-white/25 text-white" : "text-white/70 hover:text-white"}`}>
                  {t.icon}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {INK.map((c) => (
                <button key={c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} style={{ background: c }}
                  className={`w-5 h-5 rounded-full border border-white/30 ${color === c ? "ring-2 ring-white ring-offset-1 ring-offset-black" : ""}`} />
              ))}
            </div>
            <div className="flex p-0.5 rounded-lg bg-white/10 text-xs">
              {([1, 2, 3] as const).map((l) => (
                <button key={l} onClick={() => setLevel(l)}
                  className={`px-2 h-7 rounded-md ${level === l ? "bg-white/25 text-white" : "text-white/70"}`}>{["", "S", "M", "L"][l]}</button>
              ))}
            </div>
            <button className="px-2 h-8 rounded-md bg-white/10 text-white/80 hover:text-white disabled:opacity-40" disabled={!shapes.length}
              onClick={() => commit(shapes.slice(0, -1))} title="Undo (Ctrl+Z)">Undo</button>
            <button className="px-2 h-8 rounded-md bg-white/10 text-white/80 hover:text-white disabled:opacity-40" disabled={!shapes.length}
              onClick={() => confirm("Remove all drawings on this screenshot?") && commit([])}>Clear</button>
            <span className="text-xs text-white/60 w-20">{saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : saveState === "error" ? "not saved" : ""}</span>
            <button className="px-3 h-8 rounded-md bg-accent text-white" onClick={() => { commitText(); setEditing(false); }}>Done</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {canDraw && (
              <button className="px-3 py-1 rounded-md bg-white/10 text-white hover:bg-white/20" onClick={() => setEditing(true)}>
                &#9998; Draw / write
              </button>
            )}
            <a href={img.src} target="_blank" rel="noreferrer" className="hover:text-ink">Open original &#8599;</a>
            <button className="text-2xl leading-none hover:text-ink" onClick={onClose} aria-label="Close">&times;</button>
          </div>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0 px-14 pb-6 relative">
        {count > 1 && !editing && (
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl"
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + count) % count); }}
            aria-label="Previous"
          >&#8249;</button>
        )}
        <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
          <img
            src={img.src}
            alt={img.name ?? "Screenshot"}
            className="block max-w-[calc(100vw-120px)] max-h-[calc(100vh-130px)] rounded-lg shadow-2xl select-none"
            draggable={false}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {dims && (
            <svg ref={svgRef} viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
              style={{ cursor: editing ? (tool === "erase" ? "default" : tool === "text" ? "text" : "crosshair") : "default",
                pointerEvents: editing ? "auto" : "none", touchAction: "none" }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
              {shapes.map((s) => (
                <ShapeView key={s.id} s={s} onErase={editing && tool === "erase" ? (id) => commit(shapes.filter((x) => x.id !== id)) : undefined} />
              ))}
              {draft && <ShapeView s={draft} preview />}
            </svg>
          )}
          {textDraft && dims && (
            <textarea
              autoFocus
              className="absolute bg-black/60 text-white rounded border border-white/40 p-1 outline-none resize"
              style={{ left: `${(textDraft.x / dims.w) * 100}%`, top: `${(textDraft.y / dims.h) * 100}%`, color, minWidth: 160, fontSize: 14 }}
              placeholder="Type, Enter to place (Shift+Enter new line)"
              value={textDraft.value}
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
                if (e.key === "Escape") { e.preventDefault(); setTextDraft(null); }
              }}
              onBlur={commitText}
            />
          )}
        </div>
        {count > 1 && !editing && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl"
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % count); }}
            aria-label="Next"
          >&#8250;</button>
        )}
      </div>
      {editing && (
        <p className="text-center text-xs text-white/50 pb-3" onClick={(e) => e.stopPropagation()}>
          Drawings are saved on top of the screenshot; the original image is kept. Esc to stop drawing.
        </p>
      )}
    </div>
  );
}
