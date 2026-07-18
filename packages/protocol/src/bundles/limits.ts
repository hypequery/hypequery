import type {
  ProtocolDeploymentBundleLimits,
  ProtocolDeploymentBundleOptions,
} from './types.js';

export const DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS:
Readonly<ProtocolDeploymentBundleLimits> = Object.freeze({
  maxArtifacts: 100,
  maxPathBytes: 1_024,
  maxDeploymentBytes: 16 * 1_024 * 1_024,
  maxArtifactBytes: 128 * 1_024 * 1_024,
  maxTotalBytes: 256 * 1_024 * 1_024,
});

export function resolveDeploymentBundleLimits(
  options: ProtocolDeploymentBundleOptions = {},
): Readonly<ProtocolDeploymentBundleLimits> {
  const result = { ...DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolDeploymentBundleLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} `
        + '(the deployment bundle v1 maximum)',
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
