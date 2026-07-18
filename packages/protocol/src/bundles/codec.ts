import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { serializeJcs } from '../values/jcs.js';
import type {
  ProtocolDeploymentBundleManifest,
  ProtocolDeploymentBundleOptions,
} from './types.js';
import { validateProtocolDeploymentBundleManifest } from './validate.js';

const textEncoder = new TextEncoder();

export const PROTOCOL_DEPLOYMENT_BUNDLE_IDENTITY_DOMAIN = 'hypequery:deployment-bundle:v1\0';

export interface PreparedProtocolDeploymentBundleManifest {
  readonly manifest: ProtocolDeploymentBundleManifest;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export function prepareProtocolDeploymentBundleManifest(
  input: unknown,
  options: ProtocolDeploymentBundleOptions = {},
): PreparedProtocolDeploymentBundleManifest {
  const manifest = validateProtocolDeploymentBundleManifest(input, options);
  const canonical = serializeJcs(manifest);
  const bytes = textEncoder.encode(canonical);
  const identity = bytesToHex(sha256.create()
    .update(textEncoder.encode(PROTOCOL_DEPLOYMENT_BUNDLE_IDENTITY_DOMAIN))
    .update(bytes)
    .digest());
  return Object.freeze({ manifest, canonical, bytes, identity });
}

export function encodeProtocolDeploymentBundleManifest(
  input: unknown,
  options: ProtocolDeploymentBundleOptions = {},
): Uint8Array {
  return prepareProtocolDeploymentBundleManifest(input, options).bytes;
}

export function encodeProtocolDeploymentBundleManifestToString(
  input: unknown,
  options: ProtocolDeploymentBundleOptions = {},
): string {
  return prepareProtocolDeploymentBundleManifest(input, options).canonical;
}

export function hashProtocolDeploymentBundleManifest(
  input: unknown,
  options: ProtocolDeploymentBundleOptions = {},
): string {
  return prepareProtocolDeploymentBundleManifest(input, options).identity;
}
