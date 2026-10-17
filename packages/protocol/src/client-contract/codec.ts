import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { clientCanonical } from './safe-data.js';

export const CLIENT_SCHEMA_DOMAIN = 'hypequery:client-endpoint-schema:v1\0';
export const CLIENT_CONTRACT_DOMAIN = 'hypequery:client-contract:v1\0';
export function clientDigest(domain: string, value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(domain + clientCanonical(value))));
}
