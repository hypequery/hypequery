import { DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS } from '@hypequery/protocol';

export interface DeploymentIntakeLimits {
  readonly maxRequestBytes: number;
  readonly maxReleaseBytes: number;
  readonly maxManifestBytes: number;
  readonly maxPartHeaderBytes: number;
}

export const DEFAULT_DEPLOYMENT_INTAKE_LIMITS: Readonly<DeploymentIntakeLimits> = Object.freeze({
  maxRequestBytes: DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxTotalBytes + (2 * 1024 * 1024),
  maxReleaseBytes: 16 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxPartHeaderBytes: 8 * 1024,
});

export function resolveDeploymentIntakeLimits(
  input: Partial<DeploymentIntakeLimits> = {},
): Readonly<DeploymentIntakeLimits> {
  const result = { ...DEFAULT_DEPLOYMENT_INTAKE_LIMITS };
  for (const key of Object.keys(result) as (keyof DeploymentIntakeLimits)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1
      || value > DEFAULT_DEPLOYMENT_INTAKE_LIMITS[key]) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than `
        + `${DEFAULT_DEPLOYMENT_INTAKE_LIMITS[key]} (the deployment intake v1 maximum)`,
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
