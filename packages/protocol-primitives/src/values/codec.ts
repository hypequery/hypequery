import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { valueError } from './errors.js';
import { serializeJcs } from './jcs.js';
import { resolveLimits } from './limits.js';
import { parseDuplicateAwareJson } from './parser.js';
import type { CanonicalValue, CanonicalValueOptions } from './types.js';
import {
  validateCanonicalValueWithLimits,
  validateParsedCanonicalValue,
} from './validate.js';

const textEncoder = new TextEncoder();

function prepare(
  input: unknown,
  options: CanonicalValueOptions,
): { value: CanonicalValue; canonical: string; bytes: Uint8Array } {
  const limits = resolveLimits(options);
  const value = validateCanonicalValueWithLimits(
    input,
    limits,
    options.declaredClickHouseType,
  );
  const canonical = serializeJcs(value);
  const bytes = textEncoder.encode(canonical);
  if (bytes.byteLength > limits.maxCanonicalBytes) {
    valueError('HQ_VALUE_TOO_LARGE');
  }
  return { value, canonical, bytes };
}

/** Validates plain data and returns exact RFC 8785 canonical UTF-8 bytes. */
export function encodeCanonicalValue(
  input: unknown,
  options: CanonicalValueOptions = {},
): Uint8Array {
  return prepare(input, options).bytes;
}

/** String form of the exact bytes returned by `encodeCanonicalValue`. */
export function encodeCanonicalValueToString(
  input: unknown,
  options: CanonicalValueOptions = {},
): string {
  return prepare(input, options).canonical;
}

/**
 * Parses duplicate-aware UTF-8/JSON and returns a validated, deeply frozen
 * canonical value. Input need not already use canonical object-key ordering.
 */
export function decodeCanonicalValue(
  input: string | Uint8Array,
  options: CanonicalValueOptions = {},
): CanonicalValue {
  const limits = resolveLimits(options);
  const parsed = parseDuplicateAwareJson(input, limits);
  return validateParsedCanonicalValue(
    parsed,
    limits,
    options.declaredClickHouseType,
  );
}

/** Raw conformance hash only; deployment and cache domains are specified later. */
export function hashCanonicalValue(
  input: unknown,
  options: CanonicalValueOptions = {},
): string {
  return bytesToHex(sha256(prepare(input, options).bytes));
}
