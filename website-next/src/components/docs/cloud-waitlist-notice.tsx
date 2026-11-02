import { Callout } from 'fumadocs-ui/components/callout';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';

/** Shown at the top of every cloud docs page until cloud launches. */
export function CloudWaitlistNotice() {
  return (
    <Callout type="warn" title="hypequery cloud is not live yet">
      You can&apos;t sign up for or deploy to cloud today. These pages describe the planned service, and details will
      change before launch. What runs today is the open-source TypeScript and Python SDKs, in your own backend.{' '}
      <DeployWaitlist location="cloud-notice" className="font-medium text-fd-primary underline underline-offset-2" />
    </Callout>
  );
}
