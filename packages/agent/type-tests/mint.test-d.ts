import {
  mintAgentToken,
  type AgentConstraint,
  type AgentToken,
  type AgentTokenError,
  type AgentTokenField,
} from '../src/index.js';

declare const session: { orgId: string; userId: string };

// The plan's example, with the project's endpoint.
const minted: Promise<AgentToken> = mintAgentToken({
  signingKey: process.env.HYPEQUERY_AGENT_KEY!,
  project: 'acme:logistics',
  endpoint: 'https://acme-logistics-1f2e3d4c.hypequery.app',
  tenant: session.orgId,
  subject: session.userId,
  permissionSet: 'customers',
});
void minted.then(({ token, mcpUrl, expiresAt }) => {
  const bearer: string = token;
  const url: string = mcpUrl;
  const when: Date = expiresAt;
  void [bearer, url, when];
});

// Constraints are eq with one scalar, or in with a list.
const constraints: AgentConstraint[] = [
  { filter: 'region', operator: 'in', value: ['emea', 1, true] },
  { filter: 'carrier_id', operator: 'eq', value: 7 },
];
void mintAgentToken({
  signingKey: '{}',
  project: 'p',
  endpoint: 'https://p.hypequery.app',
  tenant: 't',
  subject: 's',
  permissionSet: 'c',
  constraints,
  expiresInSeconds: 300,
  now: new Date(),
});

// @ts-expect-error eq takes one value, not a list
const eqList: AgentConstraint = { filter: 'region', operator: 'eq', value: ['emea'] };
// @ts-expect-error in takes a list
const inScalar: AgentConstraint = { filter: 'region', operator: 'in', value: 'emea' };
// @ts-expect-error only eq and in
const gt: AgentConstraint = { filter: 'region', operator: 'gt', value: 1 };
void [eqList, inScalar, gt];

// @ts-expect-error the permission set is required: a managed key has no default
void mintAgentToken({ signingKey: '{}', project: 'p', endpoint: 'https://p.hypequery.app', tenant: 't', subject: 's' });
// @ts-expect-error the endpoint is required: mcpUrl is not derivable from the key
void mintAgentToken({ signingKey: '{}', project: 'p', tenant: 't', subject: 's', permissionSet: 'c' });
// @ts-expect-error a JWK must be an Ed25519 key
void mintAgentToken({ signingKey: { kty: 'RSA' }, project: 'p', endpoint: 'https://p.hypequery.app', tenant: 't', subject: 's', permissionSet: 'c' });

declare const failure: AgentTokenError;
const field: AgentTokenField = failure.field;
// @ts-expect-error fields are the option names
const notAField: AgentTokenField = 'audience';
void [field, notAField];
