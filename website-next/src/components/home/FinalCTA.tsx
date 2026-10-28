import Link from 'next/link';
import { marketing } from '../ui/marketing';
import { DeployWaitlist } from './DeployWaitlist';
import { SetupCommand } from './SetupCommand';

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 py-20 text-center">
      <h2 className="home-section-title text-text max-w-[820px] mx-auto text-balance">
        Ship your analytics layer today
      </h2>
      <p className="mt-3.5 text-body text-text-muted max-w-[560px] mx-auto text-pretty">
        Start open source in your own backend. Move to hypequery cloud when you want it hosted.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/docs/quick-start"
          className={marketing.primaryButton}
        >
          Get started <span aria-hidden="true">→</span>
        </Link>
        <DeployWaitlist location="final" className={marketing.secondaryButton} />
      </div>
      <SetupCommand className="mt-4 justify-center" />
    </section>
  );
}
