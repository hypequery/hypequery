import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { serializeJcs } from '../values/jcs.js';
import type { ProtocolDeploymentOptions } from './types.js';
import { validateProtocolDeploymentContract } from './validate.js';

const textEncoder = new TextEncoder();

/** Domain prefix for deployment contract v1 identities. */
export const PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN = 'hypequery:deployment:v1\0';

function prepareDeployment(
  input: unknown,
  options: ProtocolDeploymentOptions,
): { canonical: string; bytes: Uint8Array } {
  const contract = validateProtocolDeploymentContract(input, options);
  const canonical = serializeJcs(contract);
  return {
    canonical,
    bytes: textEncoder.encode(canonical),
  };
}

/** Validates a deployment contract and returns canonical RFC 8785 UTF-8 bytes. */
export function encodeProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): Uint8Array {
  return prepareDeployment(input, options).bytes;
}

/** String form of the canonical deployment contract bytes. */
export function encodeProtocolDeploymentContractToString(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  return prepareDeployment(input, options).canonical;
}

/** Domain-separated SHA-256 identity of a validated deployment contract. */
export function hashProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  const { bytes } = prepareDeployment(input, options);
  return bytesToHex(sha256.create()
    .update(textEncoder.encode(PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN))
    .update(bytes)
    .digest());
}
