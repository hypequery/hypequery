/**
 * Optional client-contract members a consumer opts into per discovery request.
 *
 * Validators released before a member existed reject it as an unknown field, so
 * a producer emits it only to a consumer that names its feature in this request
 * header. Tokens are comma-separated and case-insensitive; unknown tokens are
 * ignored, and an oversized header names no features.
 */
export const CLIENT_CONTRACT_FEATURES_HEADER = 'x-hypequery-client-features';
/** Field annotations' synonyms, examples, format, unit and currency (RFC 0018, 2026-11-05). */
export const CLIENT_CONTRACT_FIELD_METADATA_FEATURE = 'field-metadata';
/** Every feature this version understands, as one header value. */
export const CLIENT_CONTRACT_FEATURES = CLIENT_CONTRACT_FIELD_METADATA_FEATURE;
const MAX_FEATURES_HEADER_LENGTH = 256;

/** The feature tokens named by a features header value (`null`/`undefined` when absent). */
export function parseClientContractFeatures(value: string | null | undefined): ReadonlySet<string> {
  if (typeof value !== 'string' || value.length > MAX_FEATURES_HEADER_LENGTH) return new Set();
  return new Set(value.split(',').map(token => token.replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase()).filter(Boolean));
}

/** Whether a features header value asks for field metadata. */
export function acceptsClientFieldMetadata(value: string | null | undefined): boolean {
  return parseClientContractFeatures(value).has(CLIENT_CONTRACT_FIELD_METADATA_FEATURE);
}
