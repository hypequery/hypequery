import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { serializeJcs } from '../values/jcs.js';
import type { ProtocolDatasetOnlyContract, ProtocolDeploymentContract, ProtocolDeploymentOptions } from './types.js';
import { validateProtocolDatasetOnlyContract, validateProtocolDeploymentContract } from './validate.js';

const textEncoder = new TextEncoder();

/** Domain prefix for deployment contract v1 identities. */
export const PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN = 'hypequery:deployment:v1\0';
export const PROTOCOL_DATASET_ONLY_IDENTITY_DOMAIN = 'hypequery:deployment:v2\0';

export interface PreparedProtocolDeploymentContract {
  readonly contract: ProtocolDeploymentContract;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export interface PreparedProtocolDatasetOnlyContract {
  readonly contract: ProtocolDatasetOnlyContract;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export function prepareProtocolDatasetOnlyContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): PreparedProtocolDatasetOnlyContract {
  const contract = validateProtocolDatasetOnlyContract(input, options);
  const canonical = serializeJcs(contract);
  const bytes = textEncoder.encode(canonical);
  const identity = bytesToHex(sha256.create()
    .update(textEncoder.encode(PROTOCOL_DATASET_ONLY_IDENTITY_DOMAIN))
    .update(bytes)
    .digest());
  return Object.freeze({ contract, canonical, bytes, identity });
}

export function encodeProtocolDatasetOnlyContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): Uint8Array {
  return prepareProtocolDatasetOnlyContract(input, options).bytes;
}

export function hashProtocolDatasetOnlyContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  return prepareProtocolDatasetOnlyContract(input, options).identity;
}

/** Validates and serializes once, returning every deployment artifact representation. */
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
  return Object.freeze({
    contract,
    canonical,
    bytes,
    identity,
  });
}

/** Validates a deployment contract and returns canonical RFC 8785 UTF-8 bytes. */
export function encodeProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): Uint8Array {
  return prepareProtocolDeploymentContract(input, options).bytes;
}

/** String form of the canonical deployment contract bytes. */
export function encodeProtocolDeploymentContractToString(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  return prepareProtocolDeploymentContract(input, options).canonical;
}

/** Domain-separated SHA-256 identity of a validated deployment contract. */
export function hashProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): string {
  return prepareProtocolDeploymentContract(input, options).identity;
}
