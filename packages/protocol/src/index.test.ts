import { describe, expect, it } from 'vitest';
import * as protocol from './index.js';

describe('@hypequery/protocol public surface', () => {
  it('exports only the reviewed value and identifier surfaces', () => {
    expect(Object.keys(protocol).sort()).toEqual([
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
