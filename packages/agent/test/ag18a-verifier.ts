import { createPublicKey } from 'node:crypto';
import {
  errors as joseErrors,
  jwtVerify,
  type JWTHeaderParameters,
  type JWTPayload,
} from 'jose';

/**
 * Cloud's managed-key verifier (AG-18a), ported for tests: hypequery-cloud
 * `apps/web/src/lib/signing-keys/verify.ts` (`verifySigningKeyJwt`) and the
 * claim rules of `readCustomerClaims` with the fixed managed-key mapping.
 * A minted token must pass this exactly as it passes the tenant `/mcp`.
 * Keep it in step with Cloud; `python/hypequery/tests/agent_verifier.py`
 * ports the same rules.
 */
const SIGNING_KEY_TOKEN_MAX_LIFETIME_SECONDS = 15 * 60;
const SIGNING_KEY_ALGORITHMS = ['EdDSA', 'Ed25519'];
const CLOCK_TOLERANCE_SECONDS = 30;
const KID_PATTERN = /^hqsk_[A-Za-z0-9_-]{22}$/;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const SUBJECT = /^[\x21-\x7e]+$/;
const TENANT = /^[A-Za-z0-9._:-]+$/;
const PERMISSION_SET = /^[a-z][a-z0-9-]{0,63}$/;
const FILTER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface VerifiedAgentClaims {
  readonly subject: string;
  readonly tenantId: string;
  readonly permissionSetName: string;
  readonly constraints: readonly unknown[];
}

export function signingKeyAudience(protocolName: string): string {
  return `hypequery-agent:${protocolName}`;
}

function claim(payload: JWTPayload, name: string): unknown {
  return Object.hasOwn(payload, name) ? payload[name] : undefined;
}

function boundedString(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && pattern.test(value);
}

function isScalar(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  return typeof value === 'string' && value.length >= 1 && value.length <= 256;
}

/** `embedConstraintsSchema`: at most 8 strict `eq`/`in` constraints, one per filter. */
function validConstraints(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > 8) return false;
  const filters = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const keys = Object.keys(entry).sort();
    if (keys.join(',') !== 'filter,operator,value') return false;
    const { filter, operator, value: operand } = entry as Record<string, unknown>;
    if (typeof filter !== 'string' || !FILTER.test(filter)) return false;
    if (operator === 'eq') {
      if (!isScalar(operand)) return false;
    } else if (operator === 'in') {
      if (!Array.isArray(operand) || operand.length < 1 || operand.length > 100) return false;
      if (!operand.every(isScalar)) return false;
    } else {
      return false;
    }
    filters.add(filter);
  }
  return filters.size === value.length;
}

export async function verifySigningKeyJwt(
  token: string,
  key: { readonly kid: string; readonly publicKey: string },
  audience: string,
  now = new Date(),
): Promise<VerifiedAgentClaims | null> {
  if (!KID_PATTERN.test(key.kid) || !PUBLIC_KEY_PATTERN.test(key.publicKey)) return null;
  const verifier = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.publicKey },
    format: 'jwk',
  });
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(
      token,
      (header: JWTHeaderParameters) => {
        if (header.kid !== key.kid) throw new joseErrors.JWKSNoMatchingKey();
        return verifier;
      },
      {
        algorithms: SIGNING_KEY_ALGORITHMS,
        audience,
        requiredClaims: ['sub', 'iat', 'exp'],
        maxTokenAge: SIGNING_KEY_TOKEN_MAX_LIFETIME_SECONDS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
      },
    ));
  } catch {
    return null;
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return null;
  if (issuedAt > nowSeconds + CLOCK_TOLERANCE_SECONDS) return null;
  if (expiresAt - issuedAt > SIGNING_KEY_TOKEN_MAX_LIFETIME_SECONDS) return null;

  // readCustomerClaims with SIGNING_KEY_CLAIMS: no default permission set.
  const subject = claim(payload, 'sub');
  const tenant = claim(payload, 'tenant');
  const permissionSet = claim(payload, 'permission_set');
  if (!boundedString(subject, SUBJECT) || !boundedString(tenant, TENANT)) return null;
  if (typeof permissionSet !== 'string' || !PERMISSION_SET.test(permissionSet)) return null;
  const constraints = claim(payload, 'constraints');
  if (constraints !== undefined && !validConstraints(constraints)) return null;
  return {
    subject,
    tenantId: tenant,
    permissionSetName: permissionSet,
    constraints: constraints ?? [],
  };
}
