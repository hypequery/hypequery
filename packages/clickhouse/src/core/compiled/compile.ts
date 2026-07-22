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
const MAX_QUERY_ID_BYTES = 200;
const MAX_SQL_BYTES = 1_048_576;
const MAX_PARAMETERS = 256;
const MAX_CLICKHOUSE_TYPE_BYTES = 256;
const MAX_SENSITIVITY_LABELS = 32;
const MAX_SENSITIVITY_LABEL_BYTES = 64;
// eslint-disable-next-line no-control-regex -- control chars are exactly what we reject
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;
const QUERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SENSITIVITY_LABEL_PATTERN = /^[a-z][a-z0-9._-]*$/;
const LOGICAL_TYPES = new Set([
  'array', 'boolean', 'bytes', 'date', 'datetime', 'decimal', 'enum', 'float',
  'integer', 'map', 'null', 'string', 'tuple', 'uuid',
]);
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
  validateOperation(input.operation);
  validateSql(input.sql);
  const parameters = snapshotParameters(input.parameters ?? []);
  const values = input.values ?? {};

  validateParameterReferences(input.sql, parameters);
  const bindings = buildParameterBindings(parameters, values);
  assertNoValuesInSql(input.sql, bindings);

  const settings = resolveCompiledSettings(input.settings ?? {});
  const identifiers = validateIdentifiers(input.identifiers);
  const deadlineInputs = input.deadline
    ? {
      ...input.deadline,
      policyMaxMs: minimumDefined(input.deadline.policyMaxMs, settings.maxExecutionMs),
    }
    : undefined;
  const deadline: CompiledDeadline | undefined = deadlineInputs
    ? resolveCompiledDeadline(deadlineInputs)
    : undefined;

  const sensitivity = snapshotSensitivity(input.sensitivity);
  const debug = buildDebugForm(input.sql, parameters, settings);

  return Object.freeze({
    version: COMPILED_QUERY_VERSION,
    operation: input.operation,
    sql: input.sql,
    parameters,
    bindings,
    settings,
    identifiers,
    deadline,
    sensitivity,
    debug,
  });
}

function minimumDefined(left?: number, right?: number): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function validateOperation(operation: unknown): asserts operation is CompiledOperation {
  if (operation !== 'query' && operation !== 'command' && operation !== 'insert') {
    throw new CompiledQueryError('input-invalid', 'The compiled operation is invalid.');
  }
}

function validateSql(sql: unknown): asserts sql is string {
  if (typeof sql !== 'string' || sql.length === 0 || utf8.encode(sql).length > MAX_SQL_BYTES) {
    throw new CompiledQueryError('input-invalid', 'The compiled SQL is empty or too large.');
  }
}

function snapshotParameters(
  input: readonly CompiledParameterDeclaration[],
): readonly CompiledParameterDeclaration[] {
  if (!Array.isArray(input) || input.length > MAX_PARAMETERS) {
    throw new CompiledQueryError('too-large', 'The compiled query has too many parameters.');
  }
  return Object.freeze(input.map((declaration) => {
    const logical = declaration?.type?.logical;
    const clickHouseType = declaration?.type?.clickHouseType;
    if (
      !LOGICAL_TYPES.has(logical)
      || typeof clickHouseType !== 'string'
      || clickHouseType.length === 0
      || CONTROL_CHAR_PATTERN.test(clickHouseType)
      || utf8.encode(clickHouseType).length > MAX_CLICKHOUSE_TYPE_BYTES
      || typeof declaration.optional !== 'boolean'
    ) {
      throw new CompiledQueryError('input-invalid', 'A parameter declaration is invalid.');
    }
    return Object.freeze({
      name: declaration.name,
      type: Object.freeze({ logical, clickHouseType }),
      optional: declaration.optional,
    });
  }));
}

function snapshotSensitivity(input?: CompiledSensitivity): CompiledSensitivity {
  const tenantScoped = input?.tenantScoped ?? false;
  const labels = input?.labels ?? [];
  if (typeof tenantScoped !== 'boolean' || !Array.isArray(labels) || labels.length > MAX_SENSITIVITY_LABELS) {
    throw new CompiledQueryError('input-invalid', 'Sensitivity metadata is invalid.');
  }
  const snapshot = labels.map((label) => {
    if (
      typeof label !== 'string'
      || !SENSITIVITY_LABEL_PATTERN.test(label)
      || utf8.encode(label).length > MAX_SENSITIVITY_LABEL_BYTES
    ) {
      throw new CompiledQueryError('input-invalid', 'A sensitivity label is invalid.');
    }
    return label;
  });
  return Object.freeze({ tenantScoped, labels: Object.freeze(snapshot) });
}

function validateIdentifiers(identifiers: CompiledIdentifiers): CompiledIdentifiers {
  if (
    typeof identifiers.queryId !== 'string'
    || !QUERY_ID_PATTERN.test(identifiers.queryId)
    || utf8.encode(identifiers.queryId).length > MAX_QUERY_ID_BYTES
  ) {
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
  return Object.freeze(correlationId === undefined
    ? { queryId: identifiers.queryId }
    : { queryId: identifiers.queryId, correlationId });
}
