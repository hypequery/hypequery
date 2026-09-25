import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { loadModule } from './load-api.js';

/** Load the explicit dataset contract exported by a Cloud publication module. */
export async function loadCloudPublication(sourcePath: string): Promise<ProtocolDeploymentContract> {
  const module = await loadModule(sourcePath);
  const cloud: unknown = module.cloud ?? module.default;
  if (typeof cloud !== 'object' || cloud === null
    || !('kind' in cloud) || cloud.kind !== 'hypequery-deployment') {
    throw new Error(
      `Invalid Cloud publication: ${sourcePath}\n\n`
      + 'Export `cloud = publishToCloud({ datasets, access })` from @hypequery/datasets. '
      + 'A Serve API is not a Cloud publication.',
    );
  }
  return cloud as ProtocolDeploymentContract;
}
