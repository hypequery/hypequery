export function Stack() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] text-center">
      <div className="mx-auto max-w-[760px]">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Runs anywhere</p>
        <h2 className="text-h2 text-text text-balance">A library, not a platform.</h2>
        <p className="mt-3.5 text-body text-text-muted text-pretty">
            hypequery runs inside the backend you already have — your auth, your logging, your infra. No harness to adopt, no environment to run. If your code runs there, hypequery runs there.
        </p>
        <div className="mx-auto mt-7 max-w-[520px] rounded-lg border border-border bg-bg-card p-5 text-left">
          <div className="flex items-start gap-3">
            <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md bg-accent-soft font-mono text-[13px] font-bold text-accent">
              W
            </div>
            <div>
              <h3 className="text-[15px] font-bold leading-tight text-text">Workers, jobs, and scripts too.</h3>
              <p className="mt-1.5 text-body-sm text-text-muted">
                The same definition runs in cron jobs, queues, server actions, route handlers, CLIs, or a plain function call.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
