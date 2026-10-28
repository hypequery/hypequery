#!/usr/bin/env node
/**
 * Regenerates specs/serve-http/fixtures/jwt-v1/cases.json.
 *
 * Run from the repository root: `node packages/serve/scripts/generate-jwt-fixtures.mjs`.
 * It needs `uv` to mint the Python issuer's token.
 *
 * Every run makes new key pairs, so every asymmetric token changes. The
 * private keys are thrown away: the fixtures only ever verify.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CompactSign,
  SignJWT,
  base64url,
  exportJWK,
  exportSPKI,
  generateKeyPair,
} from 'jose';

import { createAnalyticsTokenIssuer } from '../dist/auth.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = `${ROOT}specs/serve-http/fixtures/jwt-v1/cases.json`;

const SECRET = 'hypequery-jwt-v1-fixture-secret-not-for-production-use';
const OTHER_SECRET = 'a-different-secret-that-is-also-long-enough-0123456789';
const ISSUER = 'https://issuer.hypequery.test/';
const OTHER_ISSUER = 'https://other-issuer.hypequery.test/';
const AUDIENCE = 'https://api.hypequery.test';
const OTHER_AUDIENCE = 'https://other-api.hypequery.test';
/** 2026-01-01T00:00:00Z: when every fixture token was issued. */
const ISSUED_AT = 1767225600;
/** 2100-01-01T00:00:00Z: valid tokens expire then, so they stay valid. */
const FAR_FUTURE = 4102444800;
const EXPIRED = ISSUED_AT + 3600;

const encoder = new TextEncoder();
const secretKey = encoder.encode(SECRET);

const rsa1 = await generateKeyPair('RS256', { extractable: true });
const rsa2 = await generateKeyPair('RS256', { extractable: true });
const ec1 = await generateKeyPair('ES256', { extractable: true });
const stranger = await generateKeyPair('RS256', { extractable: true });

const jwks = {
  keys: [
    { ...(await exportJWK(rsa1.publicKey)), kid: 'rsa-1', alg: 'RS256', use: 'sig' },
    // No `alg`: a key the provider lets any RSA algorithm use.
    { ...(await exportJWK(rsa2.publicKey)), kid: 'rsa-2', use: 'sig' },
    { ...(await exportJWK(ec1.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' },
  ],
};

const standard = (claims = {}) => ({
  sub: 'user-1',
  iss: ISSUER,
  aud: AUDIENCE,
  iat: ISSUED_AT,
  exp: FAR_FUTURE,
  ...claims,
});

const sign = (payload, header, key) => new SignJWT(payload).setProtectedHeader(header).sign(key);
const hs = (payload, header = {}) => sign(payload, { alg: 'HS256', ...header }, secretKey);
const rs = (payload, header = { kid: 'rsa-1' }, key = rsa1.privateKey) =>
  sign(payload, { alg: 'RS256', ...header }, key);
/** Signs bytes that need not be a JSON object. */
const hsRaw = (text, header = { alg: 'HS256' }, options) =>
  new CompactSign(encoder.encode(text)).setProtectedHeader(header).sign(secretKey, options);
const unsecured = (payload) =>
  `${base64url.encode(JSON.stringify({ alg: 'none' }))}.${base64url.encode(JSON.stringify(payload))}.`;

const withAlteredSignature = (token) => {
  const [header, payload, signature] = token.split('.');
  const first = signature[0] === 'A' ? 'B' : 'A';
  return `${header}.${payload}.${first}${signature.slice(1)}`;
};

const issuerOptions = {
  issuer: ISSUER,
  audience: AUDIENCE,
  expiresInSeconds: FAR_FUTURE - ISSUED_AT,
};
const issuerClaims = { subject: 'user-1', tenantId: 'acme', roles: ['analyst'] };

/** The TypeScript issuer's token, minted with the clock at ISSUED_AT. */
const mintTypeScript = async () => {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [ISSUED_AT * 1000]));
    }

    static now() {
      return ISSUED_AT * 1000;
    }
  };
  try {
    const issue = createAnalyticsTokenIssuer({
      secret: SECRET,
      issuer: issuerOptions.issuer,
      audience: issuerOptions.audience,
      expiresIn: `${issuerOptions.expiresInSeconds}s`,
    });
    return await issue({
      userId: issuerClaims.subject,
      tenantId: issuerClaims.tenantId,
      roles: issuerClaims.roles,
    });
  } finally {
    globalThis.Date = RealDate;
  }
};

/** The Python issuer's token, minted with the clock at ISSUED_AT. */
const mintPython = () => {
  const source = `
import json, sys
import hypequery.serve.core.jwt_auth as jwt_auth
jwt_auth._clock = lambda: ${ISSUED_AT}
o = json.loads(sys.argv[1])
issue = jwt_auth.analytics_token_issuer(
    o["secret"], issuer=o["issuer"], audience=o["audience"], expires_in=o["expiresInSeconds"]
)
print(issue(o["subject"], tenant_id=o["tenantId"], roles=o["roles"]))
`;
  return execFileSync(
    'uv',
    [
      'run', '--project', 'python/hypequery', '--frozen', '--extra', 'jwt',
      'python', '-c', source,
      JSON.stringify({ secret: SECRET, ...issuerOptions, ...issuerClaims }),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
};

const principal = (subject, { tenantId = null, roles = [], scopes = [] } = {}) => ({
  subject,
  tenantId,
  roles,
  scopes,
});

const typescriptToken = await mintTypeScript();
const pythonToken = mintPython();
const validHs = await hs(standard());

const fixtures = {
  version: 1,
  secret: SECRET,
  jwks,
  verifiers: {
    secret: { key: 'secret', issuer: ISSUER, audience: AUDIENCE },
    'secret-open': { key: 'secret' },
    'secret-multi': {
      key: 'secret',
      issuer: [OTHER_ISSUER, ISSUER],
      audience: [OTHER_AUDIENCE, AUDIENCE],
    },
    jwks: { key: 'jwks', issuer: ISSUER, audience: AUDIENCE },
    'jwks-es256': { key: 'jwks', issuer: ISSUER, audience: AUDIENCE, algorithms: ['ES256'] },
  },
  refusal: {
    status: 401,
    type: 'UNAUTHORIZED',
    message: 'Access denied',
    details: { reason: 'invalid_credentials' },
  },
  issuer: {
    issuedAt: ISSUED_AT,
    options: issuerOptions,
    claims: issuerClaims,
    payload: {
      org_id: 'acme',
      roles: ['analyst'],
      sub: 'user-1',
      iat: ISSUED_AT,
      exp: FAR_FUTURE,
      iss: ISSUER,
      aud: AUDIENCE,
    },
    tokens: { typescript: typescriptToken, python: pythonToken },
  },
  accept: [
    {
      id: 'typescript-issuer',
      verifier: 'secret',
      token: typescriptToken,
      principal: principal('user-1', { tenantId: 'acme', roles: ['analyst'] }),
    },
    {
      id: 'python-issuer',
      verifier: 'secret',
      token: pythonToken,
      principal: principal('user-1', { tenantId: 'acme', roles: ['analyst'] }),
    },
    {
      id: 'scope-string',
      verifier: 'secret',
      token: await hs(standard({ roles: ['admin', 'analyst'], scope: 'read:metrics  write:metrics' })),
      principal: principal('user-1', {
        roles: ['admin', 'analyst'],
        scopes: ['read:metrics', 'write:metrics'],
      }),
    },
    {
      id: 'scopes-array-and-wrong-types-dropped',
      verifier: 'secret',
      token: await hs(standard({ org_id: 42, roles: ['admin', 7], scopes: ['a', 1, 'b'] })),
      principal: principal('user-1', { roles: ['admin'], scopes: ['a', 'b'] }),
    },
    {
      id: 'scope-wins-over-scopes',
      verifier: 'secret',
      token: await hs(standard({ scope: 'a', scopes: ['b'] })),
      principal: principal('user-1', { scopes: ['a'] }),
    },
    {
      id: 'null-scope-falls-back-to-scopes',
      verifier: 'secret',
      token: await hs(standard({ scope: null, scopes: ['b'] })),
      principal: principal('user-1', { scopes: ['b'] }),
    },
    {
      id: 'audience-array-contains-expected',
      verifier: 'secret',
      token: await hs(standard({ aud: [OTHER_AUDIENCE, AUDIENCE] })),
      principal: principal('user-1'),
    },
    {
      id: 'one-of-several-issuers-and-audiences',
      verifier: 'secret-multi',
      token: await hs(standard({ iss: ISSUER, aud: AUDIENCE })),
      principal: principal('user-1'),
    },
    {
      id: 'unchecked-issuer-audience-and-no-exp',
      verifier: 'secret-open',
      note: 'Pins current behaviour: with no issuer or audience configured neither is checked, and exp is not required. See README.',
      token: await hs({ sub: 'user-1', iss: OTHER_ISSUER, aud: OTHER_AUDIENCE }),
      principal: principal('user-1'),
    },
    {
      id: 'iat-in-the-future',
      verifier: 'secret',
      note: 'iat is type-checked but not compared with the clock, as jose does.',
      token: await hs(standard({ iat: FAR_FUTURE - 1, nbf: ISSUED_AT })),
      principal: principal('user-1'),
    },
    {
      id: 'jwks-rs256-by-kid',
      verifier: 'jwks',
      token: await rs(standard({ org_id: 'acme', scope: 'read:metrics' })),
      principal: principal('user-1', { tenantId: 'acme', scopes: ['read:metrics'] }),
    },
    {
      id: 'jwks-key-without-alg',
      verifier: 'jwks',
      token: await rs(standard(), { kid: 'rsa-2' }, rsa2.privateKey),
      principal: principal('user-1'),
    },
    {
      id: 'jwks-es256-single-candidate-without-kid',
      verifier: 'jwks-es256',
      token: await sign(standard(), { alg: 'ES256' }, ec1.privateKey),
      principal: principal('user-1'),
    },
  ],
  reject: [
    { id: 'expired', verifier: 'secret', token: await hs(standard({ exp: EXPIRED })) },
    { id: 'not-yet-valid', verifier: 'secret', token: await hs(standard({ nbf: FAR_FUTURE })) },
    { id: 'wrong-audience', verifier: 'secret', token: await hs(standard({ aud: OTHER_AUDIENCE })) },
    {
      id: 'missing-audience',
      verifier: 'secret',
      token: await hs({ sub: 'user-1', iss: ISSUER, iat: ISSUED_AT, exp: FAR_FUTURE }),
    },
    { id: 'wrong-issuer', verifier: 'secret', token: await hs(standard({ iss: OTHER_ISSUER })) },
    {
      id: 'missing-issuer',
      verifier: 'secret',
      token: await hs({ sub: 'user-1', aud: AUDIENCE, iat: ISSUED_AT, exp: FAR_FUTURE }),
    },
    { id: 'alg-none-secret', verifier: 'secret', token: unsecured(standard()) },
    { id: 'alg-none-jwks', verifier: 'jwks', token: unsecured(standard()) },
    {
      id: 'hs256-signed-with-the-rsa-public-key',
      verifier: 'jwks',
      token: await sign(
        standard(),
        { alg: 'HS256', kid: 'rsa-1' },
        encoder.encode(await exportSPKI(rsa1.publicKey)),
      ),
    },
    { id: 'rs256-for-a-secret-verifier', verifier: 'secret', token: await rs(standard()) },
    {
      id: 'es256-for-an-rs256-verifier',
      verifier: 'jwks',
      token: await sign(standard(), { alg: 'ES256', kid: 'ec-1' }, ec1.privateKey),
    },
    { id: 'bad-signature-hs256', verifier: 'secret', token: withAlteredSignature(validHs) },
    {
      id: 'bad-signature-rs256',
      verifier: 'jwks',
      token: await rs(standard(), { kid: 'rsa-1' }, stranger.privateKey),
    },
    {
      id: 'wrong-secret',
      verifier: 'secret',
      token: await sign(standard(), { alg: 'HS256' }, encoder.encode(OTHER_SECRET)),
    },
    {
      id: 'unknown-kid',
      verifier: 'jwks',
      token: await rs(standard(), { kid: 'rsa-unknown' }),
    },
    {
      id: 'several-candidate-keys-without-kid',
      verifier: 'jwks',
      token: await rs(standard(), {}),
    },
    { id: 'exp-is-a-string', verifier: 'secret', token: await hs(standard({ exp: String(FAR_FUTURE) })) },
    { id: 'iat-is-a-string', verifier: 'secret', token: await hs(standard({ iat: String(ISSUED_AT) })) },
    { id: 'nbf-is-null', verifier: 'secret', token: await hs(standard({ nbf: null })) },
    { id: 'exp-is-true', verifier: 'secret', token: await hs(standard({ exp: true })) },
    {
      id: 'exp-is-infinity',
      verifier: 'secret',
      token: await hsRaw(
        `{"sub":"user-1","iss":"${ISSUER}","aud":"${AUDIENCE}","exp":Infinity}`,
      ),
    },
    { id: 'payload-not-an-object', verifier: 'secret', token: await hsRaw('["user-1"]') },
    {
      id: 'unknown-critical-header',
      verifier: 'secret',
      token: await hsRaw(
        JSON.stringify(standard()),
        { alg: 'HS256', crit: ['hq-ext'], 'hq-ext': true },
        { crit: { 'hq-ext': true } },
      ),
    },
    { id: 'not-a-jwt', verifier: 'secret', token: 'not-a-jwt' },
  ],
};

writeFileSync(OUT, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`wrote ${OUT}`);
