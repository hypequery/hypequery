import {
  DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS,
  resolveProtocolSchemaValueLimits,
  type ProtocolSchemaValueLimits,
} from '@hypequery/protocol';

export type DeploymentDataPlaneLimits = ProtocolSchemaValueLimits;

export const DEFAULT_DEPLOYMENT_DATA_PLANE_LIMITS = DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS;

export function resolveDeploymentDataPlaneLimits(
  input: Partial<DeploymentDataPlaneLimits> = {},
): Readonly<DeploymentDataPlaneLimits> {
  return resolveProtocolSchemaValueLimits({ limits: input });
}
