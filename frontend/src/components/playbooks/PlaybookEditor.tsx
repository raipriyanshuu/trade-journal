import { useState } from "react";
import Modal from "../Modal";
import { api, Playbook, PlaybookRule } from "../../lib/api";
import { DEFAULT_SECTIONS, PLAYBOOK_COLORS, sectionsOf, TEMPLATES, tone } from "./shared";

interface Draft {
  name: string;
  description: string;
  color: string;
  sections: string[];
  rules: (PlaybookRule & { key: string })[];
}

let seq = 0;
const key = () => `k${++seq}`;

function toDraft(pb?: Playbook | null): Draft {
  if (!pb) return { name: "", description: "", color: "violet", sections: [...DEFAULT_SECTIONS.slice(0, 3)], rules: [] };
  const secs = sectionsOf(pb.rules);
  return {
    name: pb.name, description: pb.description, color: pb.color,
    sections: secs.length ? secs : [...DEFAULT_SECTIONS.slice(0, 3)],
    rules: pb.rules.map((r) => ({ ...r, key: key() })),
  };
}

/**
 * Create or edit a playbook: name, description, colour, and rule sections.
 * Every section and rule can be renamed, reordered, added or deleted.
 */
export default function PlaybookEditor({ playbook, onClose, onSaved }: {
  playbook?: (Playbook & { rules: PlaybookRule[] }) | null;
  onClose: () => void;
  onSaved: (pb: Playbook) => void;
}) {
  const editing = !!playbook;
  const [d, setD] = useState<Draft>(() => toDraft(playbook));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null); // newly added rule gets the cursor

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  function applyTemplate(i: number) {
    const t = TEMPLATES[i];
    const secs = sectionsOf(t.rules);
    setD({
      name: d.name || (t.name === "Blank" ? "" : t.name), description: t.description, color: t.color,
      sections: secs.length ? secs : [...DEFAULT_SECTIONS.slice(0, 3)],
      rules: t.rules.map((r) => ({ ...r, key: key() })),
    });
  }

  function renameSection(old: string, name: string) {
    set({
      sections: d.sections.map((s) => (s === old ? name : s)),
      rules: d.rules.map((r) => (r.section === old ? { ...r, section: name } : r)),
    });
  }
  function moveSection(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= d.sections.length) return;
    const s = [...d.sections];
    [s[i], s[j]] = [s[j], s[i]];
    set({ sections: s });
  }
  function deleteSection(sec: string) {
    const n = d.rules.filter((r) => r.section === sec && r.text.trim()).length;
    if (n && !confirm(`Delete the "${sec}" section and its ${n} rule(s)?`)) return;
    set({ sections: d.sections.filter((s) => s !== sec), rules: d.rules.filter((r) => r.section !== sec) });
  }
  function addSection() {
    let name = DEFAULT_SECTIONS.find((s) => !d.sections.includes(s)) ?? "New section";
    let n = 2;
    while (d.sections.includes(name)) name = `New section ${n++}`;
    set({ sections: [...d.sections, name] });
  }
  function addRule(sec: string) {
    const k = key();
    // Insert after the section's last rule so it appears in place.
    const lastIdx = d.rules.map((r) => r.section).lastIndexOf(sec);
    const rules = [...d.rules];
    rules.splice(lastIdx + 1, 0, { key: k, section: sec, text: "" });
    set({ rules });
    setFocusKey(k);
  }
  function editRule(k: string, text: string) {
    set({ rules: d.rules.map((r) => (r.key === k ? { ...r, text } : r)) });
  }
  function moveRule(k: string, dir: -1 | 1) {
    const r = d.rules.find((x) => x.key === k)!;
    const same = d.rules.filter((x) => x.section === r.section);
    const i = same.findIndex((x) => x.key === k);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    const a = d.rules.indexOf(same[i]), b = d.rules.indexOf(same[j]);
    const rules = [...d.rules];
    [rules[a], rules[b]] = [rules[b], rules[a]];
    set({ rules });
  }
  function deleteRule(k: string) {
    const r = d.rules.find((x) => x.key === k)!;
    if (r.used_on && !confirm(`"${r.text}" is ticked on ${r.used_on} trade(s). Delete it anyway? Those ticks are removed too.`)) return;
    set({ rules: d.rules.filter((x) => x.key !== k) });
  }

  async function save() {
    setErr(null);
    if (!d.name.trim()) return setErr("Give the playbook a name.");
    const ordered: PlaybookRule[] = [];
    for (const sec of d.sections) {
      const name = sec.trim() || "Rules";
      for (const r of d.rules.filter((x) => x.section === sec && x.text.trim())) {
        ordered.push({ ...(r.id ? { id: r.id } : {}), section: name, text: r.text.trim() });
      }
    }
    setSaving(true);
    try {
      const body = { name: d.name, description: d.description, color: d.color, rules: ordered };
      const pb = editing ? await api.updatePlaybook(playbook!.id, body) : await api.createPlaybook(body);
      onSaved(pb);
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+:\s*/, ""));
      setSaving(false);
    }
  }

  const ruleCount = d.rules.filter((r) => r.text.trim()).length;
  return (
    <Modal wide title={editing ? `Edit playbook` : "New playbook"} open onClose={onClose} footer={
      <>
        <span className="text-xs text-ink-faint mr-auto">{ruleCount} rule{ruleCount === 1 ? "" : "s"} in {d.sections.length} section{d.sections.length === 1 ? "" : "s"}</span>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create playbook"}</button>
      </>
    }>
      {err && <p className="text-neg text-sm mb-3">{err}</p>}
      {!editing && (
        <div className="mb-4">
          <label className="label">Start from</label>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t, i) => (
              <button key={t.name} type="button" className="badge bg-card-hover text-ink-muted hover:text-ink border border-card-border"
                onClick={() => applyTemplate(i)}>{t.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-3">
        <div>
          <label className="label">Name</label>
          <input className="input" autoFocus value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Crude swing – breakout retest" />
        </div>
        <div>
          <label className="label">Colour</label>
          <div className="flex gap-1.5 pt-1.5">
            {PLAYBOOK_COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} title={c} onClick={() => set({ color: c })}
                className={`w-6 h-6 rounded-full ${tone(c).dot} ${d.color === c ? "ring-2 ring-offset-2 ring-offset-card ring-ink" : "opacity-70 hover:opacity-100"}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="mb-4">
        <label className="label">Description</label>
        <textarea className="input min-h-[52px]" value={d.description} onChange={(e) => set({ description: e.target.value })}
          placeholder="When to use this setup, what you're looking for…" />
      </div>

      <div className="space-y-3">
        {d.sections.map((sec, si) => {
          const rules = d.rules.filter((r) => r.section === sec);
          return (
            <div key={si} className="rounded-lg border border-card-border p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <input className="input !py-1 !w-auto flex-1 font-medium uppercase tracking-wide text-xs" value={sec}
                  onChange={(e) => renameSection(sec, e.target.value)} aria-label="Section name" />
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" title="Move section up" onClick={() => moveSection(si, -1)}>↑</button>
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" title="Move section down" onClick={() => moveSection(si, 1)}>↓</button>
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-neg" title="Delete section" onClick={() => deleteSection(sec)}>&times;</button>
              </div>
              <div className="space-y-1.5">
                {rules.map((r) => (
                  <div key={r.key} className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded border border-card-border shrink-0" />
                    <input className="input !py-1 text-sm" value={r.text} placeholder="Rule, e.g. Retest holds the broken level"
                      autoFocus={r.key === focusKey}
                      onChange={(e) => editRule(r.key, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(sec); } }} />
                    {r.used_on ? <span className="text-[11px] text-ink-faint whitespace-nowrap" title="Trades with this rule ticked">{r.used_on}×</span> : null}
                    <button type="button" className="text-ink-faint hover:text-ink px-1" title="Move up" onClick={() => moveRule(r.key, -1)}>↑</button>
                    <button type="button" className="text-ink-faint hover:text-ink px-1" title="Move down" onClick={() => moveRule(r.key, 1)}>↓</button>
                    <button type="button" className="text-ink-faint hover:text-neg px-1" title="Delete rule" onClick={() => deleteRule(r.key)}>&times;</button>
                  </div>
                ))}
              </div>
              <button type="button" className="text-xs text-accent-soft hover:underline mt-2" onClick={() => addRule(sec)}>+ Add rule</button>
            </div>
          );
        })}
        <button type="button" className="btn-ghost text-xs" onClick={addSection}>+ Add section</button>
      </div>
    </Modal>
  );
}
