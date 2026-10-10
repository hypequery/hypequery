import Link from 'next/link';
import { DeployWaitlist } from './DeployWaitlist';
import { SetupCommand } from './SetupCommand';

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 py-20 text-center">
      <h2 className="home-section-title text-text max-w-[820px] mx-auto text-balance">
        Build your analytics layer
      </h2>
      <p className="mt-3.5 text-body text-text-muted max-w-[560px] mx-auto text-pretty">
        Join the Cloud waitlist, or start with the open-source SDK today.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <DeployWaitlist location="final" className="inline-flex min-h-12 items-center gap-3 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 dark:text-[#0c0e14]" />
        <Link
          href="/docs/quick-start"
          className="inline-flex min-h-12 items-center text-sm font-semibold text-text transition hover:text-accent"
        >
          Get started
        </Link>
      </div>
      <SetupCommand className="mt-4 justify-center" />
    </section>
  );
}
