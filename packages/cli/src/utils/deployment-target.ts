import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';

export function deploymentTargetFromOptions(
  options: { readonly project?: string; readonly environment?: string },
  /** The resolved credential; its target is the default. */
  credential: { readonly target?: ProtocolDeploymentReleaseTarget } | undefined,
): ProtocolDeploymentReleaseTarget {
  if ((options.project === undefined) !== (options.environment === undefined)) {
    throw new Error('Pass both --project and --environment, or omit both.');
  }
  const input = options.project === undefined
    ? credential?.target
    : { project: options.project, environment: options.environment };
  if (!input) {
    throw new Error(
      'Missing deployment target. Pass both --project and --environment, '
      + 'or run `hypequery login` (browser sign-in names a target).',
    );
  }
  try {
    return validateProtocolDeploymentReleaseTarget(input);
  } catch {
    throw new Error('The deployment target is invalid.');
  }
}
