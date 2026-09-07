/**
 * Definition-time structural validation for `dataset()`.
 *
 * Every check here runs when the dataset is *constructed*, not when it is
 * queried. A dataset is normally defined at module scope, so a malformed model
 * fails at import — in the build, in CI, and in the first test that touches the
 * module — instead of on the first request that happens to exercise the broken
 * part. The alternative is a typo in `tenantKey` that constructs cleanly, passes
 * review, and is discovered by a query that quietly returns another tenant's
 * rows.
 *
 * Two categories of check live here:
 *
 * - **Identifier safety.** `source`, `tenantKey`, `timeKey`, dimension columns
 *   and measure fields are all interpolated into SQL as identifiers. They are
 *   validated once here rather than trusted at every call site that builds a
 *   predicate from them.
 * - **Raw SQL shape.** The `sql` escape hatch on dimensions and measures is an
 *   expression, never a statement. A value carrying a statement terminator or a
 *   comment is rejected structurally, so it cannot become a second statement or
 *   comment out the rest of a clause.
 */

import type {
  DatasetConfig,
  DimensionDefinition,
  MeasureDefinition,
  RelationshipDefinition,
} from '../types.js';
import { escapeRegExp, isSafeSQLIdentifier, stripSqlLiterals } from '../sql-utils.js';
import { validateDatasetAgentMetadata } from './semantic-metadata-validation.js';

type AnyDimensions = Record<string, DimensionDefinition>;
type AnyMeasures = Record<string, MeasureDefinition>;
type AnyRelationships = Record<string, RelationshipDefinition>;

/**
 * Statement terminators and comment openers.
 *
 * A raw `sql` value is spliced into a larger expression, so any of these turns
 * one expression into something else: `;` starts a second statement, `--` and
 * `/*` comment out whatever the builder appends after it.
 */
const STATEMENT_BREAKERS = /;|--|\/\*/;

/** Dataset, dimension and measure names address fields as `<relationship>.<dimension>`. */
const QUALIFIED_SEPARATOR = '.';

function fail(datasetName: string, message: string): never {
  throw new Error(`Invalid dataset "${datasetName}": ${message}`);
}

/**
 * Validates a possibly-qualified physical name such as `orders` or
 * `analytics.orders`. Each segment must stand alone as a safe identifier, so a
 * qualified name cannot smuggle anything past the per-segment check.
 */
function isSafeQualifiedName(value: string, maxSegments: number): boolean {
  const segments = value.split(QUALIFIED_SEPARATOR);
  if (segments.length > maxSegments) {
    return false;
  }
  return segments.every(isSafeSQLIdentifier);
}

function assertSafeColumn(
  datasetName: string,
  value: string,
  context: string,
): void {
  if (!isSafeSQLIdentifier(value)) {
    fail(
      datasetName,
      `${context} "${value}" is not a safe column identifier. It is interpolated into SQL, so it ` +
      'must contain only letters, numbers and underscores, and start with a letter or underscore.',
    );
  }
}

/**
 * Validates a semantic name — a dimension or measure key.
 *
 * These are not physical columns, but they are identifiers: they appear in query
 * inputs, generated tool schemas, and protocol artifacts, where the strict
 * identifier grammar applies. Rejecting here beats failing later during artifact
 * production, which is far from the definition that caused it.
 */
function assertSafeName(
  datasetName: string,
  kind: 'dimension' | 'measure',
  name: string,
): void {
  if (!isSafeSQLIdentifier(name)) {
    fail(
      datasetName,
      `${kind} name "${name}" must contain only letters, numbers and underscores, and start ` +
      'with a letter or underscore, so it stays a valid identifier in generated artifacts.',
    );
  }
}

/**
 * Checks a raw `sql` expression and the dependencies declared alongside it.
 *
 * The dependency check runs in the direction that fails silently: a declared
 * dependency the expression never references means the definition believes it
 * reads a column it does not read. The opposite direction — an identifier used
 * but not declared — would need a SQL parser, and is caught by the protocol
 * adapter when the artifact is produced.
 */
function validateRawSql(
  datasetName: string,
  kind: 'dimension' | 'measure',
  name: string,
  sql: string,
  dependencies: readonly string[] | undefined,
): void {
  if (sql.trim().length === 0) {
    fail(datasetName, `${kind} "${name}" declares an empty sql expression.`);
  }

  // Quoted spans are blanked first, so a terminator or comment opener *inside* a
  // string literal is data rather than syntax. An unterminated quote is itself a
  // rejection: left as data, an open quote would hide everything after it.
  let code: string;
  let referenceable: string;
  try {
    code = stripSqlLiterals(sql);
    // A quoted identifier is a column reference, so the dependency check below
    // needs its text even though the terminator check above must not see it.
    referenceable = stripSqlLiterals(sql, { keepQuotedIdentifiers: true });
  } catch {
    fail(datasetName, `${kind} "${name}" sql has an unterminated quoted literal.`);
  }

  if (STATEMENT_BREAKERS.test(code)) {
    fail(
      datasetName,
      `${kind} "${name}" sql must be a single expression without statement terminators or ` +
      'comments (";", "--", "/*") outside a quoted literal.',
    );
  }

  for (const dependency of dependencies ?? []) {
    // Dependencies are qualified identifiers (`analytics.orders.amount`); the
    // expression references the column itself, so the final segment is what has
    // to appear in it. Escaped before it becomes a pattern: a raw value carrying
    // regex syntax would either throw at construction or match something else.
    const segments = dependency.split(QUALIFIED_SEPARATOR);
    const column = segments[segments.length - 1] ?? '';
    if (column.length === 0 || !new RegExp(`\\b${escapeRegExp(column)}\\b`).test(referenceable)) {
      fail(
        datasetName,
        `${kind} "${name}" declares dependency "${dependency}", but its sql expression never ` +
        'references it. A dependency the expression does not read makes the definition claim ' +
        'a column it never touches.',
      );
    }
  }
}

function validateDimensions(datasetName: string, dimensions: AnyDimensions): void {
  for (const [name, definition] of Object.entries(dimensions)) {
    if (name.includes(QUALIFIED_SEPARATOR)) {
      fail(
        datasetName,
        `dimension "${name}" cannot contain "." because qualified fields are addressed as ` +
        '"<relationship>.<dimension>".',
      );
    }

    // The name is a semantic identifier in its own right — it appears in
    // protocol artifacts and query inputs — so it is checked whether or not an
    // explicit column stands in for it below. Without this, the check silently
    // depended on the column being omitted.
    assertSafeName(datasetName, 'dimension', name);

    if (definition.sql !== undefined) {
      validateRawSql(datasetName, 'dimension', name, definition.sql, definition.dependencies);
      continue;
    }

    // A dimension with no explicit column is backed by a column of the same name.
    assertSafeColumn(datasetName, definition.column ?? name, `dimension "${name}" column`);
  }
}

function validateMeasures(
  datasetName: string,
  measures: AnyMeasures,
  dimensions: AnyDimensions,
): void {
  for (const [name, definition] of Object.entries(measures)) {
    assertSafeName(datasetName, 'measure', name);

    if (definition.sql !== undefined) {
      validateRawSql(datasetName, 'measure', name, definition.sql, definition.dependencies);
    }

    // `field` and `argField` name either a declared dimension or a physical
    // column that the model deliberately does not expose (the `allowHiddenField`
    // case in metric validation). Either way the value reaches SQL, so a name
    // that is not a declared dimension must at least be a safe identifier.
    for (const [label, value] of [
      ['field', definition.field],
      ['argField', definition.argField],
    ] as const) {
      if (value === undefined || value in dimensions) {
        continue;
      }
      assertSafeColumn(datasetName, value, `measure "${name}" ${label}`);
    }
  }
}

function validateLimits(datasetName: string, limits: DatasetConfig['limits']): void {
  if (!limits) {
    return;
  }

  for (const [name, value] of Object.entries(limits)) {
    if (value === undefined) {
      continue;
    }
    if (!Number.isInteger(value) || value <= 0) {
      fail(
        datasetName,
        `limits.${name} must be a positive integer, received ${String(value)}.`,
      );
    }
  }
}

/**
 * Validates a dataset definition. Throws on the first problem found.
 *
 * Called by `dataset()` before the instance is built, so an invalid model never
 * becomes a queryable object.
 */
export function validateDatasetDefinition(
  name: string,
  config: DatasetConfig<AnyDimensions, AnyMeasures, AnyRelationships>,
): void {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Invalid dataset: a non-empty dataset name is required.');
  }

  if (!isSafeSQLIdentifier(name)) {
    fail(
      name,
      'dataset names must contain only letters, numbers and underscores, and start with a letter ' +
      'or underscore, so they remain valid identifiers in generated artifacts.',
    );
  }

  if (typeof config.source !== 'string' || config.source.trim().length === 0) {
    fail(name, 'a non-empty source table is required.');
  }

  // `database.table` is the deepest qualification ClickHouse addresses.
  if (!isSafeQualifiedName(config.source, 2)) {
    fail(
      name,
      `source "${config.source}" is not a safe table identifier. Expected "table" or ` +
      '"database.table", each segment containing only letters, numbers and underscores.',
    );
  }

  // The tenant key is the isolation boundary: it becomes a WHERE predicate on
  // every query against a tenant-scoped dataset, so it is checked here rather
  // than trusted wherever that predicate is assembled.
  if (config.tenantKey !== undefined) {
    if (config.tenantKey.trim().length === 0) {
      fail(name, 'tenantKey cannot be empty. Omit it entirely for a dataset without tenancy.');
    }
    assertSafeColumn(name, config.tenantKey, 'tenantKey');
  }

  if (config.timeKey !== undefined) {
    if (config.timeKey.trim().length === 0) {
      fail(name, 'timeKey cannot be empty. Omit it entirely for a dataset without a time key.');
    }
    if (!(config.timeKey in (config.dimensions ?? {}))) {
      assertSafeColumn(name, config.timeKey, 'timeKey');
    }
  }

  // A dataset with no dimensions is not rejected here: the query layer already
  // refuses an empty dataset query, which is the honest place for it — a
  // measure-only model is a legitimate thing to define.
  const dimensions = config.dimensions ?? {};

  validateDimensions(name, dimensions);
  validateMeasures(name, config.measures ?? {}, dimensions);
  validateLimits(name, config.limits);
  validateDatasetAgentMetadata(name, config);
}
