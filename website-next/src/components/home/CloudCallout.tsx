import { CloudHeader, CloudRail, ConnectButton, Slash, VersionSwitch } from './CloudAppFrame';
import { DeploymentsScreen, PageTitle } from './CloudWorkflow';
import { DeployWaitlist } from './DeployWaitlist';
import { marketing } from '../ui/marketing';

/** Cloud in one block: the same model, hosted, with the deployments screen as proof. The full app tour (CloudWorkflow) returns when cloud launches. */
export function CloudCallout() {
  return (
    <section aria-labelledby="cloud-callout-title" className="mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
      <div className="grid items-end gap-x-12 gap-y-5 md:grid-cols-[minmax(0,1.1fr)_auto]">
        <div>
          <h2 id="cloud-callout-title" className="home-section-title text-text">hypequery cloud</h2>
          <p className="mt-4 max-w-[600px] text-sm leading-6 text-text-muted sm:text-base">
            Publish the same model and get a hosted API and MCP server, with versions and rollback. In early access.
          </p>
        </div>
        <DeployWaitlist location="cloud" className={`${marketing.secondaryButton} justify-self-start md:justify-self-end`} />
      </div>

      <div className="mt-8 flex overflow-hidden rounded-xl border border-border bg-bg-card shadow-card">
        <CloudRail page="settings" className="max-md:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <CloudHeader logo="mobile" actions={<ConnectButton />}>
            <VersionSwitch draft={false} name="Published" detail="v42" />
            <Slash className="max-md:hidden" />
            <PageTitle>Settings › Deployments</PageTitle>
          </CloudHeader>
          <div className="overflow-hidden max-md:h-[420px] md:h-[400px]">
            <DeploymentsScreen />
          </div>
        </div>
      </div>
    </section>
  );
}
