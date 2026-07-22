import { buildDebugForm } from './debug.js';
import { CompiledQueryError } from './errors.js';
import {
  assertNoValuesInSql,
  buildParameterBindings,
  validateParameterReferences,
} from './parameters.js';
import { resolveCompiledDeadline, resolveCompiledSettings } from './settings.js';
import {
  COMPILED_QUERY_VERSION,
  type CompiledDeadline,
  type CompiledIdentifiers,
  type CompiledOperation,
  type CompiledParameterDeclaration,
  type CompiledParameterValue,
  type CompiledQueryV1,
  type CompiledSensitivity,
  type CompiledSettings,
} from './types.js';

const MAX_CORRELATION_ID_BYTES = 1024;
// eslint-disable-next-line no-control-regex -- control chars are exactly what we reject
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const utf8 = new TextEncoder();

export interface CompileQueryInput {
  readonly operation: CompiledOperation;
  /** Trusted build/server output. Callers never author this. */
  readonly sql: string;
  readonly parameters?: readonly CompiledParameterDeclaration[];
  /** Values supplied for declared parameter names. */
  readonly values?: Readonly<Record<string, CompiledParameterValue>>;
  readonly settings?: CompiledSettings;
  readonly sensitivity?: CompiledSensitivity;
  /** Server-generated authoritative identifier; the caller may add a correlation id. */
  readonly identifiers: CompiledIdentifiers;
  readonly deadline?: {
    readonly callerAtEpochMs?: number;
    readonly policyMaxMs?: number;
    readonly nowEpochMs: number;
  };
}

/**
 * Assemble and validate a `CompiledQueryV1` (RFC 0010). This constructs the execution
 * request beside the legacy positional path; it performs every fail-closed check before an
 * adapter is ever handed the query, but performs no I/O.
 */
export function compileQueryV1(input: CompileQueryInput): CompiledQueryV1 {
  const parameters = input.parameters ?? [];
  const values = input.values ?? {};

  validateParameterReferences(input.sql, parameters);
  const bindings = buildParameterBindings(parameters, values);
  assertNoValuesInSql(input.sql, bindings);

  const settings = resolveCompiledSettings(input.settings ?? {});
  const identifiers = validateIdentifiers(input.identifiers);
  const deadline: CompiledDeadline | undefined = input.deadline
    ? resolveCompiledDeadline(input.deadline)
    : undefined;

  const sensitivity: CompiledSensitivity = input.sensitivity ?? {
    tenantScoped: false,
    labels: [],
  };

  return {
    version: COMPILED_QUERY_VERSION,
    operation: input.operation,
    sql: input.sql,
    parameters,
    bindings,
    settings,
    identifiers,
    deadline,
    sensitivity,
    debug: buildDebugForm(input.sql, parameters, settings),
  };
}

function validateIdentifiers(identifiers: CompiledIdentifiers): CompiledIdentifiers {
  if (typeof identifiers.queryId !== 'string' || identifiers.queryId.length === 0) {
    throw new CompiledQueryError('internal', 'A server-generated query id is required.');
  }
  const { correlationId } = identifiers;
  if (correlationId !== undefined) {
    if (CONTROL_CHAR_PATTERN.test(correlationId)) {
      throw new CompiledQueryError(
        'input-invalid',
        'The correlation id contains control characters.'
      );
    }
    if (utf8.encode(correlationId).length > MAX_CORRELATION_ID_BYTES) {
      throw new CompiledQueryError(
        'too-large',
        'The correlation id exceeds the allowed size.'
      );
    }
  }
  return correlationId === undefined
    ? { queryId: identifiers.queryId }
    : { queryId: identifiers.queryId, correlationId };
}
