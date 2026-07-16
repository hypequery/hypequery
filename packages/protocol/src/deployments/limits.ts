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
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS[key]) {
      throw new RangeError(`Invalid deployment limit: ${key}`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
