import { describe, expect, it } from 'vitest';
import * as primitives from './index.js';

describe('@hypequery/protocol-primitives public surface', () => {
  it('exports only canonical values and identifiers', () => {
    expect(Object.keys(primitives).sort()).toEqual([
      'DEFAULT_CANONICAL_VALUE_LIMITS',
      'PROTOCOL_IDENTIFIER_LIMITS',
      'ProtocolIdentifierError',
      'ProtocolValueError',
      'decodeCanonicalValue',
      'encodeCanonicalValue',
      'encodeCanonicalValueToString',
      'hashCanonicalValue',
      'isProtocolIdentifier',
      'isProtocolQualifiedIdentifier',
      'joinProtocolQualifiedIdentifier',
      'parseProtocolIdentifier',
      'parseProtocolQualifiedIdentifier',
      'splitProtocolQualifiedIdentifier',
      'validateCanonicalValue',
    ]);
  });
});
