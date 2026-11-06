import { ProtocolClientContractError, validateProtocolClientQuery, type ProtocolClientEndpoint } from '@hypequery/protocol';
import type { ClientEndpointBinding } from '../semantic/datasets/utils/client-endpoint-binding.js';
import type { ErrorEnvelope } from '../types.js';

/** The request header a generated client or MCP bridge pins an endpoint's schema hash with. */
export const CLIENT_SCHEMA_HEADER = 'x-hypequery-client-schema';

export type ClientSchemaPrecondition =
  /** No pin: the endpoint serves the request as it always has. */
  | { readonly kind: 'unpinned' }
  /** The pin failed or the body is outside the strict client profile. */
  | { readonly kind: 'refused'; readonly status: 400 | 409; readonly error: ErrorEnvelope['error'] }
  /** The pin matched: execute this normalized body, under the client profile. */
  | { readonly kind: 'pinned'; readonly endpoint: ProtocolClientEndpoint; readonly input: Record<string, unknown> };

const SCHEMA_CHANGED: ErrorEnvelope['error'] = {
  type: 'VALIDATION_ERROR',
  message: 'Client endpoint schema changed.',
  details: { code: 'CLIENT_SCHEMA_CHANGED' },
};

/** RFC 6901 pointer segments, as Python's client_query_error reports them. */
function pointerPath(pointer: string): (string | number)[] {
  return pointer.split('/').slice(1)
    .map(part => /^\d+$/.test(part) ? Number(part) : part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * RFC 0018's execution precondition. Runs after authentication, authorization
 * and tenant resolution, and before input validation, so a stale client is
 * told its schema changed rather than that its body is invalid. A matching
 * pin also holds the body to the strict client profile, as Python's opted-in
 * endpoints do. Exposes no replacement schema.
 */
export function checkClientSchema(
  binding: ClientEndpointBinding | undefined,
  headers: Readonly<Record<string, string | undefined>>,
  input: unknown,
): ClientSchemaPrecondition {
  const pin = headers[CLIENT_SCHEMA_HEADER];
  if (binding === undefined || pin === undefined) return { kind: 'unpinned' };
  let endpoint: ProtocolClientEndpoint | undefined;
  let contract: ReturnType<ClientEndpointBinding['contract']> = undefined;
  try {
    contract = binding.contract();
    endpoint = contract?.endpoints[0];
  } catch {
    // An endpoint the contract cannot describe matches no pin a client holds.
    endpoint = undefined;
  }
  if (contract === undefined || endpoint === undefined || pin !== endpoint.schemaHash) {
    return { kind: 'refused', status: 409, error: SCHEMA_CHANGED };
  }
  try {
    const body: Record<string, unknown> = structuredClone(
      validateProtocolClientQuery(contract, endpoint.id, input ?? {}).body,
    );
    if (endpoint.time !== null && body.timezone === undefined) body.timezone = endpoint.time.defaultTimezone;
    return { kind: 'pinned', endpoint, input: body };
  } catch (error) {
    if (!(error instanceof ProtocolClientContractError)) throw error;
    return {
      kind: 'refused',
      status: 400,
      error: {
        type: 'VALIDATION_ERROR',
        message: 'Invalid client query.',
        details: { issues: [{ path: pointerPath(error.path), message: 'Invalid client query.', code: error.code }] },
      },
    };
  }
}
