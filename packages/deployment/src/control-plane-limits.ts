export interface DeploymentControlPlaneLimits {
  readonly maxActivationRequestBytes: number;
  readonly maxHistoryPageSize: number;
}

export const DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS:
Readonly<DeploymentControlPlaneLimits> = Object.freeze({
  maxActivationRequestBytes: 16 * 1024,
  maxHistoryPageSize: 100,
});

export function resolveDeploymentControlPlaneLimits(
  input: Partial<DeploymentControlPlaneLimits> = {},
): Readonly<DeploymentControlPlaneLimits> {
  const limits = { ...DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS };
  for (const key of Object.keys(limits) as (keyof DeploymentControlPlaneLimits)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1
      || value > DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS[key]) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than the control-plane v1 maximum`,
      );
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}
