import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { serializeJcs } from '../values/jcs.js';
import type {
  ProtocolDeploymentContract,
  ProtocolDeploymentContractV3,
  ProtocolDeploymentOptions,
} from './types.js';
import { isContract3Envelope, validateProtocolDeploymentContract, validateProtocolDeploymentContractV3 } from './validate.js';

const textEncoder = new TextEncoder();

export const PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN = 'hypequery:deployment:v2\0';
/** Identity domain for deployment contract 3 (RFC 0015). */
export const PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN = 'hypequery:deployment:v3\0';

export interface PreparedProtocolDeploymentContract {
  readonly contract: ProtocolDeploymentContract;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export interface PreparedProtocolDeploymentContractV3
  extends Omit<PreparedProtocolDeploymentContract, 'contract'> {
  readonly contract: ProtocolDeploymentContractV3;
}

function identify<T>(contract: T, domain: string) {
  const canonical = serializeJcs(contract);
  const bytes = textEncoder.encode(canonical);
  const identity = bytesToHex(sha256.create()
    .update(textEncoder.encode(domain))
    .update(bytes)
    .digest());
  return Object.freeze({ contract, canonical, bytes, identity });
}

export function prepareProtocolDeploymentContract(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): PreparedProtocolDeploymentContract {
  return identify(validateProtocolDeploymentContract(input, options), PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN);
}

/** Validates, canonically encodes, and identifies a deployment contract 3. */
export function prepareProtocolDeploymentContractV3(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): PreparedProtocolDeploymentContractV3 {
  return identify(validateProtocolDeploymentContractV3(input, options), PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN);
}

/** A prepared deployment contract of any version this package reads. */
export type PreparedProtocolDeploymentContractAnyVersion =
  | PreparedProtocolDeploymentContract
  | PreparedProtocolDeploymentContractV3;

/**
 * Validates, canonically encodes, and identifies a deployment contract 2 or 3,
 * selected by its `version`. Each version keeps its own identity domain, so a
 * contract 2 artifact keeps the identity it had before contract 3 existed.
 */
export function prepareProtocolDeploymentContractAnyVersion(
  input: unknown,
  options: ProtocolDeploymentOptions = {},
): PreparedProtocolDeploymentContractAnyVersion {
  return isContract3Envelope(input)
    ? prepareProtocolDeploymentContractV3(input, options)
    : prepareProtocolDeploymentContract(input, options);
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
