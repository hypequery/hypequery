import { InstallCommand } from './InstallCommand';

const STEPS = [
  {
    label: 'Point it at your ClickHouse',
    body: (
      <>
        <span className="font-mono text-text">generate:types</span> introspects your live schema — no remodelling, no migrations, works against the tables you already have.
      </>
    ),
  },
  {
    label: 'Get a fully-typed client',
    body: (
      <>
        Tables, columns, and result rows are generated into <span className="font-mono text-text">analytics/schema.ts</span>. Autocomplete and compile-time checks, instantly.
      </>
    ),
  },
  {
    label: 'Start building',
    body: <>Write your first type-safe query in seconds — then model metrics on top when you&apos;re ready.</>,
  },
];

export function Quickstart() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-6">
      <div className="mb-10 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Quickstart</p>
        <h2 className="text-h2 text-text mx-auto max-w-[920px] text-balance">
          Generate types from your schema.
        </h2>
        <p className="mt-3.5 text-body text-text-muted mx-auto max-w-[600px] text-pretty">
          One command turns your existing ClickHouse into a fully-typed client. Start building with type safety in seconds.
        </p>
        <div className="mt-7 flex justify-center">
          <InstallCommand command="npx @hypequery/cli generate:types" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {STEPS.map((item, index) => (
          <div key={item.label} className="rounded-lg border border-border bg-bg-card p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[11px] font-bold text-text-muted">
                {index + 1}
              </span>
              <div className="text-[14px] font-bold leading-tight text-text">{item.label}</div>
            </div>
            <p className="mt-1.5 text-body-sm text-text-muted">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
