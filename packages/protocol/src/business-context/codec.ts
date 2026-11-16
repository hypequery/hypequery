import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { serializeJcs } from '../values/jcs.js';
import { businessContextError } from './errors.js';
import { resolveBusinessContextLimits } from './limits.js';
import type {
  ProtocolBusinessContext,
  ProtocolBusinessContextOptions,
} from './types.js';
import { validateProtocolBusinessContext } from './validate.js';

const textEncoder = new TextEncoder();

export const PROTOCOL_BUSINESS_CONTEXT_IDENTITY_DOMAIN = 'hypequery:business-context:v1\0';

export interface PreparedProtocolBusinessContext {
  readonly context: ProtocolBusinessContext;
  readonly canonical: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export function prepareProtocolBusinessContext(
  input: unknown,
  options: ProtocolBusinessContextOptions = {},
): PreparedProtocolBusinessContext {
  const limits = resolveBusinessContextLimits(options);
  const context = validateProtocolBusinessContext(input, options);
  const canonical = serializeJcs(context);
  const bytes = textEncoder.encode(canonical);
  if (bytes.byteLength > limits.maxBytes) businessContextError('HQ_BUSINESS_CONTEXT_TOO_LARGE');
  const identity = bytesToHex(sha256.create()
    .update(textEncoder.encode(PROTOCOL_BUSINESS_CONTEXT_IDENTITY_DOMAIN))
    .update(bytes)
    .digest());
  return Object.freeze({ context, canonical, bytes, identity });
}

export function encodeProtocolBusinessContext(
  input: unknown,
  options: ProtocolBusinessContextOptions = {},
): Uint8Array {
  return prepareProtocolBusinessContext(input, options).bytes;
}

export function encodeProtocolBusinessContextToString(
  input: unknown,
  options: ProtocolBusinessContextOptions = {},
): string {
  return prepareProtocolBusinessContext(input, options).canonical;
}

export function hashProtocolBusinessContext(
  input: unknown,
  options: ProtocolBusinessContextOptions = {},
): string {
  return prepareProtocolBusinessContext(input, options).identity;
}
