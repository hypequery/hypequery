import type { ProtocolDeploymentLimits, ProtocolDeploymentOptions } from './types.js';

export const DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS: Readonly<ProtocolDeploymentLimits> = Object.freeze({
  maxDatasets: 100,
  maxQueries: 1_000,
  maxArtifacts: 100,
  maxDatasetItems: 1_000,
  maxTextBytes: 4_096,
  maxSourceBytes: 1_024,
  maxPathBytes: 2_048,
});

export function resolveDeploymentLimits(
  options: ProtocolDeploymentOptions = {},
): Readonly<ProtocolDeploymentLimits> {
  const result = { ...DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolDeploymentLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} (the deployment contract v1 maximum)`,
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
