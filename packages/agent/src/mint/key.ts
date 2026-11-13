import { AgentTokenError } from './errors.js';

/**
 * A managed signing key's private half, as Cloud shows it once (AG-18a):
 * an Ed25519 JWK with its key id.
 */
export interface AgentSigningJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
  readonly d: string;
  readonly kid: string;
  readonly alg?: 'EdDSA';
  readonly use?: 'sig';
  /** The project's protocol name, which Cloud adds so minting needs no `project`. */
  readonly hq_project?: string;
  /** The project's customer endpoint, which Cloud adds so minting needs no `endpoint`. */
  readonly hq_endpoint?: string;
}

export interface ParsedSigningKey {
  readonly kid: string;
  readonly jwk: { kty: 'OKP'; crv: 'Ed25519'; x: string; d: string };
  /** `hq_project` and `hq_endpoint` as found, checked only when used. */
  readonly project: unknown;
  readonly endpoint: unknown;
}

/** Cloud's key ids: `hqsk_` and 16 random bytes, base64url. */
const KID_PATTERN = /^hqsk_[A-Za-z0-9_-]{22}$/;
/** An Ed25519 key, public or private, is 32 bytes: 43 base64url characters. */
const KEY_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function refuse(message: string): never {
  throw new AgentTokenError('signingKey', message);
}

/**
 * Reads the signing key from the JSON Cloud shows (or the object it parses
 * to). Members it doesn't use are ignored. Only the shape is checked here;
 * `mint.ts` checks that `x` is `d`'s public key, since Cloud verifies with `x`.
 */
export function parseSigningKey(input: unknown): ParsedSigningKey {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input.trim());
    } catch {
      refuse('The signing key is not valid JSON. Use the private key exactly as Cloud showed it.');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse('The signing key must be the private key JSON Cloud showed when it was created.');
  }
  const jwk = value as Record<string, unknown>;
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    refuse('The signing key must be an Ed25519 key (kty "OKP", crv "Ed25519").');
  }
  if (jwk.alg !== undefined && jwk.alg !== 'EdDSA') refuse('The signing key\'s alg must be "EdDSA".');
  if (jwk.use !== undefined && jwk.use !== 'sig') refuse('The signing key\'s use must be "sig".');
  if (typeof jwk.kid !== 'string' || !KID_PATTERN.test(jwk.kid)) {
    refuse('The signing key has no hypequery key id (kid "hqsk_…").');
  }
  if (typeof jwk.d !== 'string' || !KEY_BYTES_PATTERN.test(jwk.d)) {
    refuse('The signing key has no private key (d). Use the private key, not the public one.');
  }
  if (typeof jwk.x !== 'string' || !KEY_BYTES_PATTERN.test(jwk.x)) {
    refuse('The signing key has no public key (x).');
  }
  return {
    kid: jwk.kid,
    jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d },
    project: jwk.hq_project,
    endpoint: jwk.hq_endpoint,
  };
}
