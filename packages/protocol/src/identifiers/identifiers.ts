import {
  PROTOCOL_IDENTIFIER_LIMITS,
  type ProtocolIdentifier,
  type ProtocolIdentifierErrorCode,
  type ProtocolQualifiedIdentifier,
} from './types.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_PREFIX = '__hypequery';
const textEncoder = new TextEncoder();

export class ProtocolIdentifierError extends TypeError {
  readonly code: ProtocolIdentifierErrorCode;

  constructor(code: ProtocolIdentifierErrorCode) {
    super(code);
    this.name = 'ProtocolIdentifierError';
    this.code = code;
  }
}

function identifierError(code: ProtocolIdentifierErrorCode): never {
  throw new ProtocolIdentifierError(code);
}

function parseSegment(input: unknown, emptyCode: ProtocolIdentifierErrorCode): ProtocolIdentifier {
  if (typeof input !== 'string') identifierError('HQ_IDENTIFIER_TYPE');
  if (input.length === 0) identifierError(emptyCode);
  if (textEncoder.encode(input).byteLength > PROTOCOL_IDENTIFIER_LIMITS.maxSegmentBytes) {
    identifierError('HQ_IDENTIFIER_TOO_LONG');
  }
  if (!IDENTIFIER_PATTERN.test(input)) identifierError('HQ_IDENTIFIER_INVALID_FORMAT');
  if (input.toLowerCase().startsWith(RESERVED_PREFIX)) {
    identifierError('HQ_IDENTIFIER_RESERVED');
  }
  return input as ProtocolIdentifier;
}

/** Parses one portable, case-sensitive logical identifier segment. */
export function parseProtocolIdentifier(input: unknown): ProtocolIdentifier {
  return parseSegment(input, 'HQ_IDENTIFIER_EMPTY');
}

/** Parses a dot-qualified portable identifier without normalizing it. */
export function parseProtocolQualifiedIdentifier(
  input: unknown,
): ProtocolQualifiedIdentifier {
  if (typeof input !== 'string') identifierError('HQ_IDENTIFIER_TYPE');
  if (input.length === 0) identifierError('HQ_IDENTIFIER_EMPTY');
  if (textEncoder.encode(input).byteLength > PROTOCOL_IDENTIFIER_LIMITS.maxQualifiedBytes) {
    identifierError('HQ_IDENTIFIER_TOO_LONG');
  }
  const segments = input.split('.');
  if (segments.length > PROTOCOL_IDENTIFIER_LIMITS.maxSegments) {
    identifierError('HQ_IDENTIFIER_TOO_MANY_SEGMENTS');
  }
  for (const segment of segments) {
    parseSegment(segment, 'HQ_IDENTIFIER_INVALID_FORMAT');
  }
  return input as ProtocolQualifiedIdentifier;
}

export function splitProtocolQualifiedIdentifier(
  input: ProtocolQualifiedIdentifier,
): readonly ProtocolIdentifier[] {
  return Object.freeze(input.split('.') as ProtocolIdentifier[]);
}

export function joinProtocolQualifiedIdentifier(
  segments: readonly unknown[],
): ProtocolQualifiedIdentifier {
  if (segments.length === 0) identifierError('HQ_IDENTIFIER_EMPTY');
  if (segments.length > PROTOCOL_IDENTIFIER_LIMITS.maxSegments) {
    identifierError('HQ_IDENTIFIER_TOO_MANY_SEGMENTS');
  }
  const value = segments
    .map((segment) => parseSegment(segment, 'HQ_IDENTIFIER_INVALID_FORMAT'))
    .join('.');
  return parseProtocolQualifiedIdentifier(value);
}

export function isProtocolIdentifier(input: unknown): input is ProtocolIdentifier {
  try {
    parseProtocolIdentifier(input);
    return true;
  } catch {
    return false;
  }
}

export function isProtocolQualifiedIdentifier(
  input: unknown,
): input is ProtocolQualifiedIdentifier {
  try {
    parseProtocolQualifiedIdentifier(input);
    return true;
  } catch {
    return false;
  }
}
