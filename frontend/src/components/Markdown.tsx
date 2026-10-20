// Minimal, safe Markdown renderer for AI review text (headings, bullets, bold).
// Builds React elements only -- never injects HTML.

function inline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={`${keyBase}-${i}`} className="text-ink">{p.slice(2, -2)}</strong> : <span key={`${keyBase}-${i}`}>{p}</span>,
  );
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: JSX.Element[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${k}`} className="list-disc ml-5 space-y-1 mb-3">
          {bullets.map((b, i) => <li key={i}>{inline(b, `li-${k}-${i}`)}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flush(i);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      out.push(<h4 key={i} className="text-sm font-semibold text-ink mt-3 mb-1">{inline(heading[2], `h-${i}`)}</h4>);
    } else if (line.trim()) {
      out.push(<p key={i} className="mb-2">{inline(line, `p-${i}`)}</p>);
    }
  });
  flush(lines.length);
  return <div className="text-sm text-ink-muted leading-relaxed">{out}</div>;
}
