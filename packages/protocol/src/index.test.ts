import { describe, expect, it } from 'vitest';
import * as protocol from './index.js';

describe('@hypequery/protocol public surface', () => {
  it('exports only the reviewed protocol surfaces', () => {
    expect(Object.keys(protocol).sort()).toEqual([
      'DEFAULT_CANONICAL_VALUE_LIMITS',
      'DEFAULT_PROTOCOL_EXPRESSION_LIMITS',
      'DEFAULT_PROTOCOL_SCHEMA_LIMITS',
      'PROTOCOL_IDENTIFIER_LIMITS',
      'ProtocolExpressionError',
      'ProtocolIdentifierError',
      'ProtocolSchemaError',
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
      'validateProtocolExpression',
      'validateProtocolSchema',
      'validateProtocolSemanticQuery',
    ]);
  });
});
