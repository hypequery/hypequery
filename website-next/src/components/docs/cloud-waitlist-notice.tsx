import { Callout } from 'fumadocs-ui/components/callout';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';

/** Shown at the top of every Cloud docs page while Cloud is waitlist-only. */
export function CloudWaitlistNotice() {
  return (
    <Callout type="error" title="Cloud is waitlist only">
      hypequery Cloud is not generally available yet. These docs describe early access, and details may change.{' '}
      <DeployWaitlist location="docs-cloud" className="font-medium text-fd-primary underline underline-offset-2" />
    </Callout>
  );
}
