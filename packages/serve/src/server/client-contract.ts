import { buildDatasetClientContract, type DatasetClientEndpoint } from '@hypequery/datasets';
import type { PreparedProtocolClientContract } from '@hypequery/protocol';
import type { ClientEndpointBinding } from '../semantic/datasets/utils/client-endpoint-binding.js';

/** Validate the trusted mount path every client contract path starts with. */
export function resolveClientMountPath(mountPath: string | undefined): string {
  if (mountPath === undefined || mountPath === '') return '';
  if (!mountPath.startsWith('/') || mountPath.endsWith('/')) {
    throw new Error('createAPI: clientContract.mountPath must be empty or an absolute path without a trailing slash.');
  }
  return mountPath;
}

/** The build view of every describable endpoint, in registration order. */
export function exportClientContract(
  bindings: readonly ClientEndpointBinding[],
  mountPath: string,
): PreparedProtocolClientContract {
  const definitions = bindings
    .map(binding => binding.definition())
    .filter((definition): definition is DatasetClientEndpoint => definition !== undefined);
  return buildDatasetClientContract(definitions, { mountPath });
}
