import { Callout } from 'fumadocs-ui/components/callout';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';

/** Shown at the top of every cloud docs page while cloud is waitlist-only. */
export function CloudWaitlistNotice() {
  return (
    <Callout type="warn" title="Cloud is waitlist only">
      hypequery cloud is not generally available yet. These docs describe early access, and details may change.{' '}
      <DeployWaitlist location="cloud-notice" className="font-medium text-fd-primary underline underline-offset-2" />
    </Callout>
  );
}
