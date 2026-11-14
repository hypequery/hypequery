import {
  validateProtocolBusinessContext,
  type ProtocolBusinessContext,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import { loadModule } from './load-api.js';

export interface LoadedCloudPublication {
  readonly contract: ProtocolDeploymentContract;
  /** Present only when the module exports `defineCloudPublication({ businessContext })`. */
  readonly businessContext?: ProtocolBusinessContext;
}

function hasKind(value: unknown, kind: string): value is { kind: string } {
  return typeof value === 'object' && value !== null
    && 'kind' in value && (value as { kind?: unknown }).kind === kind;
}

/**
 * Load the Cloud publication exported by a module.
 *
 * Accepts `defineCloudPublication({ deployment, businessContext })` and, for
 * compatibility, a bare `publishToCloud(...)` contract with no context.
 */
export async function loadCloudPublication(sourcePath: string): Promise<LoadedCloudPublication> {
  const module = await loadModule(sourcePath);
  const cloud: unknown = module.cloud ?? module.default;

  if (hasKind(cloud, 'hypequery-deployment')) {
    return { contract: cloud as unknown as ProtocolDeploymentContract };
  }

  if (hasKind(cloud, 'hypequery-cloud-publication')) {
    const publication = cloud as {
      version?: unknown;
      deployment?: unknown;
      businessContext?: unknown;
    };
    if (publication.version !== 1) {
      throw new Error(
        `Unsupported Cloud publication version in ${sourcePath}. `
        + 'Upgrade @hypequery/cli to deploy it.',
      );
    }
    if (!hasKind(publication.deployment, 'hypequery-deployment')) {
      throw new Error(
        `Invalid Cloud publication: ${sourcePath}\n\n`
        + '`deployment` must be the result of `publishToCloud({ datasets, access })`.',
      );
    }
    const contract = publication.deployment as unknown as ProtocolDeploymentContract;
    if (publication.businessContext === undefined) return { contract };
    let businessContext: ProtocolBusinessContext;
    try {
      businessContext = validateProtocolBusinessContext(publication.businessContext);
    } catch (error) {
      throw new Error(
        `Invalid business context in ${sourcePath}\n\n`
        + (error instanceof Error ? error.message : String(error)),
      );
    }
    return { contract, businessContext };
  }

  throw new Error(
    `Invalid Cloud publication: ${sourcePath}\n\n`
    + 'Export `cloud = defineCloudPublication({ deployment: publishToCloud({ datasets, access }), '
    + 'businessContext })` or `cloud = publishToCloud({ datasets, access })` from @hypequery/datasets. '
    + 'A Serve API is not a Cloud publication.',
  );
}
