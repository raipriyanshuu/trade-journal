import { useEffect } from "react";

interface Props {
  images: { src: string; name?: string | null }[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

/** Full-screen image viewer: Esc / click outside closes, arrow keys navigate. */
export default function Lightbox({ images, index, onIndex, onClose }: Props) {
  const count = images.length;
  const img = images[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
  }, [index, count, onIndex, onClose]);

  if (!img) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-2 text-sm text-ink-muted" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">{img.name || "Screenshot"}{count > 1 ? ` · ${index + 1} / ${count}` : ""}</span>
        <div className="flex items-center gap-3">
          <a href={img.src} target="_blank" rel="noreferrer" className="hover:text-ink">Open original &#8599;</a>
          <button className="text-2xl leading-none hover:text-ink" onClick={onClose} aria-label="Close">&times;</button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0 px-14 pb-6 relative">
        {count > 1 && (
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl"
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + count) % count); }}
            aria-label="Previous"
          >&#8249;</button>
        )}
        <img
          src={img.src}
          alt={img.name ?? "Screenshot"}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        {count > 1 && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl"
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % count); }}
            aria-label="Next"
          >&#8250;</button>
        )}
      </div>
    </div>
  );
}
