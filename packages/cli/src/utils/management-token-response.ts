import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import { normalizeCloudDeploymentEndpoint } from './cloud-credential-store.js';
import { defaultDeploymentEndpoint } from './cloud-origin.js';
import { isManagementTokenValue } from './cloud-token-kind.js';
import type { StoredManagementCredential } from './management-token-store.js';

// Cloud issues 30-day management tokens. Refuse only what is clearly broken:
// an expiry in the past or absurdly far away.
const MAX_MANAGEMENT_TOKEN_LIFETIME_MS = 400 * 24 * 60 * 60_000;
const MAX_FIELD_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH ? value : undefined;
}

export interface ManagementTokenResponseContext {
  readonly origin: string;
  readonly now: number;
  readonly signedInWith: 'browser' | 'device';
}

/**
 * The management token in a Cloud sign-in response: browser sign-in's
 * `POST /api/cli/token` with `management_token: true` (AG-04) or device
 * sign-in's `POST /api/cli/device/token` (AG-05). Both send the same fields.
 * Null when the response has none, which is how a Cloud without management
 * tokens answers browser sign-in. Throws when one is present but malformed.
 */
export function managementCredentialFromResponse(
  input: unknown,
  context: ManagementTokenResponseContext,
): StoredManagementCredential | null {
  if (!isRecord(input)) throw new Error('Cloud returned an invalid sign-in response.');
  // Device sign-in also sends the token as `access_token`; browser sign-in's
  // `access_token` is the separate deploy credential.
  const token = input.management_token
    ?? (context.signedInWith === 'device' ? input.access_token : undefined);
  if (token === undefined) return null;
  if (!isManagementTokenValue(token)) {
    throw new Error('Cloud returned an invalid management token.');
  }
  const expiresAtInput = input.management_token_expires_at
    ?? (context.signedInWith === 'device' ? input.expires_at : undefined);
  const expiresAt = typeof expiresAtInput === 'string' ? Date.parse(expiresAtInput) : Number.NaN;
  if (!Number.isFinite(expiresAt)
    || expiresAt <= context.now
    || expiresAt > context.now + MAX_MANAGEMENT_TOKEN_LIFETIME_MS) {
    throw new Error('Cloud returned an invalid management token expiration.');
  }
  const capabilities = Array.isArray(input.capabilities)
    && input.capabilities.length <= 64
    && input.capabilities.every(value => boundedString(value) !== undefined)
    ? input.capabilities as string[]
    : undefined;
  // Browser sign-in names the deployment endpoint and target; device sign-in
  // may not, and then the CLI uses the origin's protocol endpoint and asks for
  // --project and --environment.
  let deploymentEndpoint = defaultDeploymentEndpoint(context.origin);
  if (input.deployment_endpoint !== undefined) {
    if (typeof input.deployment_endpoint !== 'string') {
      throw new Error('Cloud returned an invalid deployment endpoint.');
    }
    deploymentEndpoint = normalizeCloudDeploymentEndpoint(input.deployment_endpoint, context.origin);
  }
  let target: ProtocolDeploymentReleaseTarget | undefined;
  if (input.deployment_target !== undefined && input.deployment_target !== null) {
    try {
      target = validateProtocolDeploymentReleaseTarget(input.deployment_target);
    } catch {
      throw new Error('Cloud returned an invalid CLI deployment target.');
    }
  }
  const organizationId = boundedString(input.organization_id);
  const project = boundedString(input.project);
  return {
    cloudUrl: context.origin,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    deploymentEndpoint,
    ...(organizationId ? { organizationId } : {}),
    ...(project ? { project } : {}),
    projectLimited: input.project_limited === true,
    ...(capabilities ? { capabilities } : {}),
    ...(target ? { target } : {}),
    signedInWith: context.signedInWith,
  };
}
