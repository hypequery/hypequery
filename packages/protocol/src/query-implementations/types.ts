import type { ProtocolSemanticQuery } from '../expressions/index.js';
import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type { ProtocolSchema } from '../schemas/index.js';

export type ProtocolSqlDialect = 'clickhouse';

export interface ProtocolSqlExpression {
  readonly kind: 'sql-expression';
  readonly dialect: ProtocolSqlDialect;
  readonly sql: string;
  readonly output: ProtocolSchema;
  readonly dependencies: readonly ProtocolQualifiedIdentifier[];
}

export type ProtocolSqlParameterSource =
  | { readonly kind: 'input'; readonly path: ProtocolQualifiedIdentifier }
  | { readonly kind: 'tenant' };

export interface ProtocolSqlParameter {
  readonly name: ProtocolIdentifier;
  readonly source: ProtocolSqlParameterSource;
  readonly clickHouseType: string;
}

export type ProtocolSqlTenantPolicy =
  | { readonly kind: 'required'; readonly parameter: ProtocolIdentifier }
  | { readonly kind: 'not-required' };

export type ProtocolQueryImplementation =
  | {
      readonly kind: 'semantic-plan';
      readonly query: ProtocolSemanticQuery;
    }
  | {
      readonly kind: 'compiled-sql';
      readonly dialect: ProtocolSqlDialect;
      readonly operation: 'select';
      readonly statement: string;
      readonly parameters: readonly ProtocolSqlParameter[];
      readonly readSources: readonly string[];
      readonly tenant: ProtocolSqlTenantPolicy;
    }
  | {
      readonly kind: 'runtime-reference';
      readonly runtime: 'node' | 'python';
      readonly artifactSha256: string;
      readonly entrypoint: ProtocolQualifiedIdentifier;
    };

export interface ProtocolQueryImplementationLimits {
  readonly maxStatementBytes: number;
  readonly maxExpressionBytes: number;
  readonly maxTypeBytes: number;
  readonly maxSourceBytes: number;
  readonly maxCollectionItems: number;
}

export interface ProtocolQueryImplementationOptions {
  readonly limits?: Partial<ProtocolQueryImplementationLimits>;
}

export type ProtocolQueryImplementationErrorCode =
  | 'HQ_QUERY_IMPLEMENTATION_TYPE'
  | 'HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD'
  | 'HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND'
  | 'HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER'
  | 'HQ_QUERY_IMPLEMENTATION_INVALID_VALUE'
  | 'HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE'
  | 'HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS'
  | 'HQ_QUERY_IMPLEMENTATION_TOO_LARGE'
  | 'HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT';
