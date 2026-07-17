import { describe, expect, it } from 'vitest';
import * as protocol from './index.js';

describe('@hypequery/protocol public surface', () => {
  it('exports only the reviewed protocol surfaces', () => {
    expect(Object.keys(protocol).sort()).toEqual([
      'DEFAULT_CANONICAL_VALUE_LIMITS',
      'DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS',
      'DEFAULT_PROTOCOL_EXPRESSION_LIMITS',
      'DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS',
      'DEFAULT_PROTOCOL_SCHEMA_LIMITS',
      'PROTOCOL_DEPLOYMENT_IDENTITY_DOMAIN',
      'PROTOCOL_IDENTIFIER_LIMITS',
      'ProtocolDeploymentError',
      'ProtocolExpressionError',
      'ProtocolIdentifierError',
      'ProtocolQueryImplementationError',
      'ProtocolSchemaError',
      'ProtocolValueError',
      'decodeCanonicalValue',
      'encodeCanonicalValue',
      'encodeCanonicalValueToString',
      'encodeProtocolDeploymentContract',
      'encodeProtocolDeploymentContractToString',
      'hashCanonicalValue',
      'hashProtocolDeploymentContract',
      'isProtocolIdentifier',
      'isProtocolQualifiedIdentifier',
      'joinProtocolQualifiedIdentifier',
      'parseProtocolIdentifier',
      'parseProtocolQualifiedIdentifier',
      'splitProtocolQualifiedIdentifier',
      'validateCanonicalValue',
      'validateProtocolDatasetContract',
      'validateProtocolDeploymentContract',
      'validateProtocolExpression',
      'validateProtocolQueryImplementation',
      'validateProtocolSchema',
      'validateProtocolSemanticQuery',
      'validateProtocolSqlExpression',
    ]);
  });
});
