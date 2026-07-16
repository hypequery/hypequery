import type { ProtocolIdentifier } from '../identifiers/index.js';
import type { CanonicalValue } from '../values/index.js';

interface ProtocolSchemaAnnotations {
  readonly description?: string;
  readonly default?: CanonicalValue;
}

export type ProtocolSchema =
  | (ProtocolSchemaAnnotations & { readonly kind: 'any' })
  | { readonly kind: 'void'; readonly description?: string }
  | (ProtocolSchemaAnnotations & { readonly kind: 'null' })
  | (ProtocolSchemaAnnotations & { readonly kind: 'boolean' })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'string';
      readonly minLength?: number;
      readonly maxLength?: number;
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'number' | 'integer';
      readonly minimum?: number;
      readonly exclusiveMinimum?: number;
      readonly maximum?: number;
      readonly exclusiveMaximum?: number;
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'literal';
      readonly value: CanonicalValue;
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'enum';
      readonly values: readonly CanonicalValue[];
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'array';
      readonly items: ProtocolSchema;
      readonly minItems?: number;
      readonly maxItems?: number;
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'object';
      readonly properties: Readonly<Record<ProtocolIdentifier, ProtocolSchema>>;
      readonly required: readonly ProtocolIdentifier[];
      readonly unknownProperties: 'reject' | 'strip' | 'preserve';
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'record';
      readonly values: ProtocolSchema;
    })
  | (ProtocolSchemaAnnotations & {
      readonly kind: 'union';
      readonly variants: readonly ProtocolSchema[];
    });

export interface ProtocolSchemaLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCollectionItems: number;
  readonly maxDescriptionBytes: number;
}

export interface ProtocolSchemaOptions {
  readonly limits?: Partial<ProtocolSchemaLimits>;
}

export type ProtocolSchemaErrorCode =
  | 'HQ_SCHEMA_TYPE'
  | 'HQ_SCHEMA_UNKNOWN_FIELD'
  | 'HQ_SCHEMA_UNKNOWN_KIND'
  | 'HQ_SCHEMA_INVALID_IDENTIFIER'
  | 'HQ_SCHEMA_INVALID_VALUE'
  | 'HQ_SCHEMA_INVALID_CONSTRAINT'
  | 'HQ_SCHEMA_INVALID_REQUIRED'
  | 'HQ_SCHEMA_DUPLICATE_VALUE'
  | 'HQ_SCHEMA_TOO_DEEP'
  | 'HQ_SCHEMA_TOO_MANY_NODES'
  | 'HQ_SCHEMA_TOO_MANY_ITEMS'
  | 'HQ_SCHEMA_TOO_LARGE'
  | 'HQ_SCHEMA_UNSAFE_OBJECT';
