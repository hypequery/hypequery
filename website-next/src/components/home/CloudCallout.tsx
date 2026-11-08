import { DeployWaitlist } from './DeployWaitlist';
import { marketing } from '../ui/marketing';

/** Cloud in one block: the same model, hosted. The full app tour (CloudWorkflow) returns when cloud launches. */
export function CloudCallout() {
  return (
    <section aria-labelledby="cloud-callout-title" className="mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
      <div className="grid items-center gap-x-12 gap-y-5 rounded-2xl border border-border bg-bg-card/40 p-6 sm:p-8 md:grid-cols-[minmax(0,1.1fr)_auto]">
        <div>
          <h2 id="cloud-callout-title" className="home-section-title text-text">hypequery cloud</h2>
          <p className="mt-4 max-w-[600px] text-sm leading-6 text-text-muted sm:text-base">
            Publish the same model and get a hosted API and MCP server, with versions and rollback. In early access.
          </p>
        </div>
        <DeployWaitlist location="cloud" className={`${marketing.secondaryButton} justify-self-start md:justify-self-end`} />
      </div>
    </section>
  );
}
