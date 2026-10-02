import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import type { StoredCloudCredential } from './cloud-credential-store.js';

export function deploymentTargetFromOptions(
  options: { readonly project?: string; readonly environment?: string },
  credential: StoredCloudCredential | undefined,
): ProtocolDeploymentReleaseTarget {
  if ((options.project === undefined) !== (options.environment === undefined)) {
    throw new Error('Pass both --project and --environment, or omit both.');
  }
  const input = options.project === undefined
    ? credential?.target
    : { project: options.project, environment: options.environment };
  if (!input) {
    throw new Error(
      'Missing deployment target. Run `hypequery login` or pass both '
      + '--project and --environment.',
    );
  }
  try {
    return validateProtocolDeploymentReleaseTarget(input);
  } catch {
    throw new Error('The deployment target is invalid.');
  }
}
