import { useEffect, useState } from "react";

/**
 * Text that edits in place: click it (or "Edit") to get a textarea, then Save
 * (Ctrl+Enter) or Cancel (Esc). Empty values show a clickable placeholder.
 */
export default function EditableText({ label, value, placeholder, onSave, rows = 4 }: {
  label?: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => Promise<unknown>;
  rows?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
    setErr(null);
  }

  return (
    <div className="group">
      {!(editing && !label) && (
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-ink-faint">{label}</div>
          {!editing && (
            <button type="button" className="text-[11px] text-ink-faint hover:text-accent-soft opacity-60 group-hover:opacity-100"
              onClick={() => setEditing(true)}>
              &#9998; Edit
            </button>
          )}
        </div>
      )}
      {editing ? (
        <div className="mt-1">
          <textarea
            autoFocus
            className="input text-sm"
            rows={rows}
            value={draft}
            disabled={saving}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button type="button" className="btn-primary !py-1 !px-3 text-xs" onClick={save} disabled={saving || draft === value}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost !py-1 !px-3 text-xs" onClick={cancel} disabled={saving}>Cancel</button>
            <span className="text-[11px] text-ink-faint">Ctrl+Enter to save &middot; Esc to cancel</span>
          </div>
          {err && <p className="text-xs text-neg mt-1">{err}</p>}
        </div>
      ) : (
        <p
          className={`text-sm whitespace-pre-wrap cursor-text rounded -mx-1 px-1 hover:bg-card-hover ${value ? "text-ink-muted" : "text-ink-faint italic"}`}
          title="Click to edit"
          onClick={() => setEditing(true)}
        >
          {value || placeholder}
        </p>
      )}
    </div>
  );
}
