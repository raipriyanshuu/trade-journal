import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Horizontally scrollable card with a second scrollbar on top, kept in sync with
 * the bottom one. The top bar sticks to the top of the page while you scroll
 * down a long table, so you never have to go to the bottom to scroll sideways.
 */
export default function ScrollX({ children, className = "" }: { children: ReactNode; className?: string }) {
  const top = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [width, setWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const b = body.current;
    if (!b) return;
    const measure = () => {
      setWidth(b.scrollWidth);
      setOverflows(b.scrollWidth > b.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    if (b.firstElementChild) ro.observe(b.firstElementChild);
    return () => ro.disconnect();
  }, [children]);

  // Mirror one scrollbar's position onto the other without echoing back.
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
  };

  return (
    <div className={`card ${className}`}>
      <div
        ref={top}
        className={`sticky top-0 z-10 overflow-x-auto overflow-y-hidden bg-card rounded-t-xl border-b border-card-border ${overflows ? "" : "hidden"}`}
        onScroll={() => sync(top.current, body.current)}
        aria-hidden
      >
        <div style={{ width, height: 1 }} />
      </div>
      <div ref={body} className="overflow-x-auto" onScroll={() => sync(body.current, top.current)}>
        {children}
      </div>
    </div>
  );
}
