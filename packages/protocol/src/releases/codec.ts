import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { serializeJcs } from '../values/jcs.js';
import type {
  ProtocolDeploymentReleaseEnvelope,
  ProtocolDeploymentReleaseOptions,
} from './types.js';
import { validateProtocolDeploymentReleaseEnvelope } from './validate.js';

const textEncoder = new TextEncoder();

export const PROTOCOL_DEPLOYMENT_RELEASE_IDENTITY_DOMAIN = 'hypequery:deployment-release:v1\0';

export interface PreparedProtocolDeploymentReleaseEnvelope {
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export function prepareProtocolDeploymentReleaseEnvelope(
  input: unknown,
  options: ProtocolDeploymentReleaseOptions = {},
): PreparedProtocolDeploymentReleaseEnvelope {
  const release = validateProtocolDeploymentReleaseEnvelope(input, options);
  const canonical = serializeJcs(release);
  const bytes = textEncoder.encode(canonical);
  const identity = bytesToHex(sha256.create()
    .update(textEncoder.encode(PROTOCOL_DEPLOYMENT_RELEASE_IDENTITY_DOMAIN))
    .update(bytes)
    .digest());
  return Object.freeze({ release, canonical, bytes, identity });
}

export function encodeProtocolDeploymentReleaseEnvelope(
  input: unknown,
  options: ProtocolDeploymentReleaseOptions = {},
): Uint8Array {
  return prepareProtocolDeploymentReleaseEnvelope(input, options).bytes;
}

export function encodeProtocolDeploymentReleaseEnvelopeToString(
  input: unknown,
  options: ProtocolDeploymentReleaseOptions = {},
): string {
  return prepareProtocolDeploymentReleaseEnvelope(input, options).canonical;
}

export function hashProtocolDeploymentReleaseEnvelope(
  input: unknown,
  options: ProtocolDeploymentReleaseOptions = {},
): string {
  return prepareProtocolDeploymentReleaseEnvelope(input, options).identity;
}
