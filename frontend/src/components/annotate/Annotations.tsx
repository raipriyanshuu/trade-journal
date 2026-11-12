import { useState } from "react";
import { Shape } from "../../lib/api";

/** Colours offered for drawing on screenshots (bright enough for dark and light charts). */
export const INK = ["#f3b53d", "#f0566b", "#22c58b", "#38bdf8", "#a78bfa", "#ffffff", "#111827"];

/** Default stroke / text size for an image, so drawings look the same on big and small screenshots. */
export const sizeFor = (w: number, level: 1 | 2 | 3, text = false) =>
  Math.max(text ? 14 : 2, Math.round((text ? w / 48 : w / 420) * [0, 0.7, 1, 1.6][level]));

function arrowHead(s: Shape) {
  const { x1 = 0, y1 = 0, x2 = 0, y2 = 0, size } = s;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = size * 4.5;
  const p = (ang: number) => `${x2 - len * Math.cos(a + ang)},${y2 - len * Math.sin(a + ang)}`;
  return `${x2},${y2} ${p(0.45)} ${p(-0.45)}`;
}

/** One shape as SVG. */
export function ShapeView({ s, preview, onErase }: { s: Shape; preview?: boolean; onErase?: (id: string) => void }) {
  const ev = onErase
    ? { style: { cursor: "pointer", pointerEvents: "visiblePainted" as const }, onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); onErase(s.id); } }
    : { style: { pointerEvents: "none" as const } };
  const stroke = { stroke: s.color, strokeWidth: s.size, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    strokeDasharray: preview ? `${s.size * 3} ${s.size * 2}` : undefined };
  const { x1 = 0, y1 = 0, x2 = x1, y2 = y1 } = s;
  switch (s.type) {
    case "pen":
      return <polyline points={(s.points ?? []).map((p) => p.join(",")).join(" ")} fill="none" {...stroke} {...ev} />;
    case "line":
      return <line x1={x1} y1={y1} x2={x2} y2={y2} {...stroke} {...ev} />;
    case "arrow":
      return (
        <g {...ev}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...stroke} />
          <polygon points={arrowHead(s)} fill={s.color} />
        </g>
      );
    case "box":
      return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
        fill={`${s.color}1f`} {...stroke} {...ev} />;
    case "circle":
      return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2}
        fill={`${s.color}1f`} {...stroke} {...ev} />;
    case "text": {
      const lines = (s.text ?? "").split("\n");
      return (
        <text x={x1} y={y1} fill={s.color} fontSize={s.size} fontWeight={600} fontFamily="Inter, system-ui, sans-serif"
          stroke="rgba(0,0,0,0.55)" strokeWidth={s.size / 9} paintOrder="stroke" dominantBaseline="hanging" {...ev}>
          {lines.map((l, i) => <tspan key={i} x={x1} dy={i === 0 ? 0 : s.size * 1.2}>{l || " "}</tspan>)}
        </text>
      );
    }
  }
}

/** SVG layer sized in image pixels; place it over an image with the same aspect ratio. */
export function AnnotationLayer({ shapes, width, height, children, className = "" }: {
  shapes: Shape[]; width: number; height: number; children?: React.ReactNode; className?: string;
}) {
  if (!width || !height) return null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`absolute inset-0 w-full h-full ${className}`} preserveAspectRatio="none">
      {shapes.map((s) => <ShapeView key={s.id} s={s} />)}
      {children}
    </svg>
  );
}

/** An image with its drawings on top (full width, natural aspect ratio). */
export function AnnotatedImage({ src, shapes, alt, className = "", onClick }: {
  src: string; shapes?: Shape[] | null; alt?: string; className?: string; onClick?: () => void;
}) {
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className={`relative ${className}`} onClick={onClick}>
      <img src={src} alt={alt ?? "Screenshot"} className="block w-full h-auto rounded-lg"
        onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {dim && shapes && shapes.length > 0 && <AnnotationLayer shapes={shapes} width={dim.w} height={dim.h} />}
    </div>
  );
}

/** Fixed-height thumbnail (natural width) with its drawings on top. */
export function AnnotatedThumb({ src, shapes, alt, className = "", title, onClick }: {
  src: string; shapes?: Shape[] | null; alt?: string; className?: string; title?: string; onClick?: () => void;
}) {
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  return (
    <span className="relative inline-block align-top" onClick={onClick} title={title}>
      <img src={src} alt={alt ?? "Screenshot"} className={`block ${className}`}
        onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {dim && shapes && shapes.length > 0 && <AnnotationLayer shapes={shapes} width={dim.w} height={dim.h} className="rounded-lg" />}
    </span>
  );
}
