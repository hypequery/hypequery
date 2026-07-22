import type { ProtocolIdentifier, TaggedValue } from '@hypequery/protocol';

/**
 * Execution-request contract from RFC 0010 (compiled query, error, cancellation),
 * realized for the ClickHouse runtime.
 *
 * This is the versioned shape a runtime hands to an adapter. It sits *beside* the
 * legacy positional path (`adapter.query(sql, params: unknown[])`, which renders
 * values into SQL text via `substituteParameters`). Nothing here lets a request
 * author SQL, tenant proof, or settings — those are trusted build/policy output.
 *
 * NOTE: distinct from the internal `CompiledQuery` in `../../types/base.ts`, which
 * is the SQL-formatter fragment `{ query, parameters }`.
 */
export const COMPILED_QUERY_VERSION = 1 as const;

/** Closed operation set (RFC 0010 §Operations). The operation belongs to the compiled
 * query, never to the request. */
export type CompiledOperation = 'query' | 'command' | 'insert';

/**
 * A logical parameter type. The logical tag drives validation and the `{name:Type}`
 * placeholder the adapter sends; `clickHouseType` is the concrete server type string
 * (e.g. `UInt64`, `DateTime64(3, 'UTC')`, `Array(String)`).
 */
export interface CompiledParameterType {
  /** RFC 0001 logical tag, or a scalar shorthand for native JSON scalars. */
  readonly logical: TaggedValue['$hypequery']['type'] | 'boolean' | 'string' | 'float' | 'null';
  /** Concrete ClickHouse server type used to build the native placeholder. */
  readonly clickHouseType: string;
}

/**
 * A named, typed parameter declaration carried beside the SQL text. A request supplies
 * only values for declared names; it can neither add names nor change types.
 */
export interface CompiledParameterDeclaration {
  readonly name: ProtocolIdentifier;
  readonly type: CompiledParameterType;
  /** Optional parameters may be absent from a request; required ones fail closed. */
  readonly optional: boolean;
}

/** A supplied parameter value: an RFC 0001 tagged value or a native JSON scalar. */
export type CompiledParameterValue = TaggedValue | string | number | boolean | null;

/**
 * The resolved `{name: value}` map the adapter binds to native server parameters.
 * Every key is a declared parameter name; no value is ever rendered into SQL text.
 */
export type CompiledParameterBindings = Readonly<Record<string, CompiledParameterValue>>;

/**
 * Data sensitivity metadata. Marks whether the query touches tenant-scoped or otherwise
 * sensitive data so diagnostics/redaction downstream can act without inspecting values.
 */
export interface CompiledSensitivity {
  /** The compiled SQL already contains trusted tenant predicates (RFC 0010 §Operations). */
  readonly tenantScoped: boolean;
  /** Free-form trusted classification labels (e.g. 'pii'); never request-supplied. */
  readonly labels: readonly string[];
}

/**
 * Bounded settings the runtime applies per execution. These originate only from trusted
 * components; a request can never set, override, or relax them. See `settings.ts` for the
 * closed allow-list and ranges.
 */
export interface CompiledSettings {
  /** Wall-clock ceiling for server-side execution, milliseconds. Always enforced. */
  readonly maxExecutionMs?: number;
  /** Maximum rows the result may contain. */
  readonly maxResultRows?: number;
  /** Maximum bytes the result may contain. */
  readonly maxResultBytes?: number;
}

/** Effective deadline + cancellation inputs (RFC 0010 §Deadline and cancellation). */
export interface CompiledDeadline {
  /** Epoch-millis absolute deadline. Earlier of caller-supplied and policy-derived. */
  readonly atEpochMs: number;
  /** Which side set the effective deadline, for honest diagnostics. */
  readonly source: 'caller' | 'policy';
}

/** Authoritative + optional correlation identifiers (RFC 0010 §Query identifier). */
export interface CompiledIdentifiers {
  /** Server-generated, unique per execution, unguessable, safe for logs/cache metadata. */
  readonly queryId: string;
  /** Caller-supplied, non-authoritative, ≤1024 UTF-8 bytes, no control chars; never
   * influences routing, cache keys, or authorization. */
  readonly correlationId?: string;
}

/**
 * Redacted, non-executable debug form (RFC 0010 §Debug form). Shows SQL structure with
 * placeholders and declared types; carries no values, tenant values, credentials, or
 * settings beyond their names. `sql` here is deliberately not valid database SQL.
 */
export interface CompiledDebugForm {
  readonly sql: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly optional: boolean;
  }[];
  readonly settings: readonly string[];
}

/**
 * The compiled query: the only way a runtime asks a ClickHouse adapter to execute.
 */
export interface CompiledQueryV1 {
  readonly version: typeof COMPILED_QUERY_VERSION;
  readonly operation: CompiledOperation;
  /** Trusted build/server output. Callers influence execution only via `bindings`. */
  readonly sql: string;
  readonly parameters: readonly CompiledParameterDeclaration[];
  /** Resolved values for declared names, bound to native server parameters. */
  readonly bindings: CompiledParameterBindings;
  readonly settings: CompiledSettings;
  readonly identifiers: CompiledIdentifiers;
  readonly deadline?: CompiledDeadline;
  readonly sensitivity: CompiledSensitivity;
  readonly debug: CompiledDebugForm;
}
