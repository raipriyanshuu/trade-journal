interface Props {
  title: string;
  phase: number;
  description: string;
}

export default function PagePlaceholder({ title, phase, description }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">{title}</h1>
      <p className="text-ink-muted mb-6 text-sm">{description}</p>
      <div className="card p-10 flex flex-col items-center justify-center text-center gap-3">
        <span className="badge bg-accent/15 text-accent-soft">Phase {phase}</span>
        <p className="text-ink-muted max-w-md">
          This screen is built in <span className="text-ink">Phase {phase}</span>. The
          foundation (data model, instruments, accounts, settings) is ready now.
        </p>
      </div>
    </div>
  );
}
