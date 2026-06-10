import Link from 'next/link';
import { InstallCommand } from './InstallCommand';

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 py-20 text-center">
      <h2 className="text-h2 text-text max-w-[820px] mx-auto text-balance">
        Model your data once. Ship it everywhere.
      </h2>
      <p className="mt-3.5 text-body text-text-muted max-w-[560px] mx-auto text-pretty">
        Start anywhere — adopt what you need, when you need it.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <InstallCommand />
        <Link
          href="/docs"
          className="inline-flex items-center justify-center rounded bg-text px-5 py-3 text-[13.5px] font-semibold text-bg transition hover:-translate-y-px hover:opacity-90"
        >
          Read the docs →
        </Link>
      </div>
    </section>
  );
}
