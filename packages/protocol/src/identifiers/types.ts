export const PROTOCOL_IDENTIFIER_LIMITS = Object.freeze({
  maxSegmentBytes: 128,
  maxQualifiedBytes: 512,
  maxSegments: 8,
} as const);

declare const protocolIdentifierBrand: unique symbol;
declare const protocolQualifiedIdentifierBrand: unique symbol;

export type ProtocolIdentifier = string & {
  readonly [protocolIdentifierBrand]: true;
};

export type ProtocolQualifiedIdentifier = string & {
  readonly [protocolQualifiedIdentifierBrand]: true;
};

export type ProtocolIdentifierErrorCode =
  | 'HQ_IDENTIFIER_TYPE'
  | 'HQ_IDENTIFIER_EMPTY'
  | 'HQ_IDENTIFIER_TOO_LONG'
  | 'HQ_IDENTIFIER_INVALID_FORMAT'
  | 'HQ_IDENTIFIER_RESERVED'
  | 'HQ_IDENTIFIER_TOO_MANY_SEGMENTS';
