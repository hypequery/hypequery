import type {
  ProtocolDeploymentReleaseLimits,
  ProtocolDeploymentReleaseOptions,
} from './types.js';

export const DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS:
Readonly<ProtocolDeploymentReleaseLimits> = Object.freeze({
  maxTargetBytes: 128,
});

export function resolveDeploymentReleaseLimits(
  options: ProtocolDeploymentReleaseOptions = {},
): Readonly<ProtocolDeploymentReleaseLimits> {
  const result = { ...DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolDeploymentReleaseLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_PROTOCOL_DEPLOYMENT_RELEASE_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} `
        + '(the deployment release v1 maximum)',
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
