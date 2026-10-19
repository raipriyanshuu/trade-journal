import { ReactNode } from "react";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export default function Modal({ title, open, onClose, children, footer }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-card-border">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-ink-faint hover:text-ink text-lg leading-none" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer ? (
          <div className="px-5 py-3 border-t border-card-border flex justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
