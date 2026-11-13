import { base64UrlEncode } from './base64url.js';
import {
  AGENT_TOKEN_MAX_LIFETIME_SECONDS,
  checkConstraints,
  checkLifetime,
  checkPermissionSet,
  checkProject,
  checkSubject,
  checkTenant,
  type AgentConstraint,
} from './claims.js';
import { resolveMcpUrl } from './endpoint.js';
import { AgentTokenError } from './errors.js';
import { parseSigningKey, type AgentSigningJwk } from './key.js';

export interface MintAgentTokenOptions {
  /**
   * The managed signing key's private key, as the JSON Cloud showed once
   * (keep it in `HYPEQUERY_AGENT_KEY`), or that JSON parsed.
   */
  readonly signingKey: string | AgentSigningJwk;
  /** The project's protocol name, as Cloud shows it beside the key (for example "acme:logistics"). */
  readonly project: string;
  /**
   * The project's customer endpoint, as Cloud shows it: its origin
   * (`https://<endpoint>.hypequery.app`) or its `/mcp` URL. `mcpUrl` is
   * `<origin>/mcp`.
   */
  readonly endpoint: string;
  /** The end user's customer: every query is scoped to this tenant. */
  readonly tenant: string;
  /** The end user, as your app identifies them. */
  readonly subject: string;
  /** The permission set the end user acts with, by name. */
  readonly permissionSet: string;
  /** Filters every query carries, on top of the permission set. */
  readonly constraints?: readonly AgentConstraint[];
  /** Lifetime in seconds, at most 900 (15 minutes, Cloud's ceiling). Defaults to 900. */
  readonly expiresInSeconds?: number;
  /** The issue time; defaults to now. */
  readonly now?: Date;
}

export interface AgentToken {
  /** A compact JWS: send it as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** The project's tenant MCP endpoint. */
  readonly mcpUrl: string;
  /** When the token stops working; mint a new one before then. */
  readonly expiresAt: Date;
}

/** Cloud's audience for a project's managed-key tokens (AG-18a). */
export function agentTokenAudience(project: string): string {
  return `hypequery-agent:${checkProject(project)}`;
}

const encoder = new TextEncoder();

function encodeJson(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('mintAgentToken needs Web Crypto (globalThis.crypto.subtle): Node 20 or later.');
  }
  return subtle;
}

/**
 * Mints an end-user token for a project's tenant MCP endpoint, signed locally
 * with a managed signing key (AG-18a, decision 0019 §15). No network call:
 * call it per session or per request.
 *
 * The token is an EdDSA JWT whose `kid` names the key, with audience
 * `hypequery-agent:<project>`, claims `sub`, `tenant`, `permission_set`,
 * optional `constraints`, `iat` and `exp`, and a lifetime of at most 15
 * minutes. For the same options and time, it is byte-for-byte the token
 * Python's `mint_agent_token()` mints.
 *
 * @throws AgentTokenError when an option is one Cloud would refuse.
 */
export async function mintAgentToken(options: MintAgentTokenOptions): Promise<AgentToken> {
  const key = parseSigningKey(options.signingKey);
  const audience = agentTokenAudience(options.project);
  const mcpUrl = resolveMcpUrl(options.endpoint);
  const subject = checkSubject(options.subject);
  const tenant = checkTenant(options.tenant);
  const permissionSet = checkPermissionSet(options.permissionSet);
  const constraints =
    options.constraints === undefined ? [] : checkConstraints(options.constraints);
  const lifetime = checkLifetime(options.expiresInSeconds ?? AGENT_TOKEN_MAX_LIFETIME_SECONDS);
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new AgentTokenError('now', 'now must be a valid Date.');
  }
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = issuedAt + lifetime;

  // Fixed member order, so both languages serialize the same bytes.
  const header = { alg: 'EdDSA', kid: key.kid, typ: 'JWT' };
  const payload = {
    aud: audience,
    sub: subject,
    tenant,
    permission_set: permissionSet,
    ...(constraints.length > 0 ? { constraints } : {}),
    iat: issuedAt,
    exp: expiresAt,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;

  const subtle = subtleCrypto();
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  try {
    privateKey = await subtle.importKey('jwk', key.jwk, { name: 'Ed25519' }, false, ['sign']);
    publicKey = await subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: key.jwk.x },
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  } catch {
    throw new AgentTokenError('signingKey', 'The signing key is not a valid Ed25519 key.');
  }
  const data = encoder.encode(signingInput);
  const signature = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, privateKey, data));
  // Cloud verifies with `x`: a key whose `x` isn't `d`'s would mint tokens it refuses.
  if (!(await subtle.verify({ name: 'Ed25519' }, publicKey, signature, data))) {
    throw new AgentTokenError(
      'signingKey',
      'The signing key\'s public key (x) does not match its private key (d).',
    );
  }
  return {
    token: `${signingInput}.${base64UrlEncode(signature)}`,
    mcpUrl,
    expiresAt: new Date(expiresAt * 1_000),
  };
}
