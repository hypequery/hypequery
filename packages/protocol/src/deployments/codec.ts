import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { serializeJcs } from '../values/jcs.js';
import type { ProtocolDeploymentContract, ProtocolDeploymentOptions } from './types.js';
import { validateProtocolDeploymentContract } from './validate.js';

const textEncoder = new TextEncoder();

export const PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN = 'hypequery:deployment:v2\0';

export interface PreparedProtocolDeploymentContract {
  readonly contract: ProtocolDeploymentContract;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export function prepareProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): PreparedProtocolDeploymentContract {
  const contract = validateProtocolDeploymentContract(input, options);
  const canonical = serializeJcs(contract);
  const bytes = textEncoder.encode(canonical);
  const identity = bytesToHex(sha256.create()
    .update(textEncoder.encode(PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN))
    .update(bytes)
    .digest());
  return Object.freeze({ contract, canonical, bytes, identity });
}

export function encodeProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): Uint8Array {
  return prepareProtocolDeploymentContract(input, options).bytes;
}

export function hashProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  return prepareProtocolDeploymentContract(input, options).identity;
}

export function encodeProtocolDeploymentContractToString(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  return prepareProtocolDeploymentContract(input, options).canonical;
}
