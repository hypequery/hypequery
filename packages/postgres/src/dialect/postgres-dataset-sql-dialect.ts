import { defineDatasetSqlDialectRules, type DatasetSqlDialectRules } from '@hypequery/datasets/internal';
import { quotePostgresIdentifier, quotePostgresQualifiedName } from '../utils/identifiers.js';
import { orderTerm } from '../compiler/compile-select.js';
import { stripPostgresLiterals } from './strip-literals.js';
import {
  addTime, parseTimestamp, periodValue, subtractTime, timeDiff, toQueryTimezone, truncateTime, zonedTimeRules,
} from './postgres-time-sql.js';
import { argExtremeSql, percentileSql } from '../utils/aggregate-sql.js';
import { GUARD_PREFIX } from './guard-errors.js';

/** Statement terminators and comment openers outside literals. */
const STATEMENT_BREAKERS = /;|--|\/\*/;

/** A capability Postgres has no spelling for; the dataset query is refused. */
function unsupported(capability: string): never {
  throw new Error(`${capability} is not supported on Postgres.`);
}

/** Standard-conforming string: only a quote needs escaping. */
function stringLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('A Postgres string literal cannot contain a NUL character.');
  return `'${value.replace(/'/g, "''")}'`;
}

function finiteNumber(value: number, context: string): string {
  if (!Number.isFinite(value)) throw new Error(`${context} contains a non-finite number.`);
  return String(value);
}

const BINARY_OPERATORS = { add: '+', subtract: '-', multiply: '*', divide: '/' } as const;

/**
 * ClickHouse `round(x, n)` on a float: scale by 10^n, round half to even,
 * scale back. Postgres `ROUND(double precision)` rounds half to even too
 * (`rint`); `ROUND(numeric, n)` would round half away from zero instead.
 */
function roundSql(value: string, digits: string | undefined): string {
  const float = `CAST(${value} AS double precision)`;
  if (digits === undefined) return `ROUND(${float})`;
  const places = Number(digits);
  if (!Number.isSafeInteger(places) || Math.abs(places) > 15) {
    throw new Error('Formula round() needs an integer number of decimal places between -15 and 15.');
  }
  const scale = `CAST(1e${Math.abs(places)} AS double precision)`;
  return places >= 0 ? `(ROUND(${float} * ${scale}) / ${scale})` : `(ROUND(${float} / ${scale}) * ${scale})`;
}

/**
 * Postgres spelling for everything the datasets planner emits. Results match
 * ClickHouse: division is floating point (Postgres truncates integer
 * division), NULLs sort last in both directions, weeks start on Sunday.
 */
export const postgresDatasetSqlDialect: DatasetSqlDialectRules = defineDatasetSqlDialectRules({
  name: 'postgres',
  withQueryTimezone: (timezone: string) => zonedRules(timezone),
  quoteIdentifier: quotePostgresIdentifier,

  placeholder: (index: number) => `$${index + 1}`,
  reusesPlaceholders: true,
  embedsPositionalPieces: false,

  orderTerm: (expression: string, direction?: 'ASC' | 'DESC') => orderTerm({ expression, direction }),
  paginate: (limit: number | undefined, offset: number | undefined) =>
    `${limit === undefined ? '' : ` LIMIT ${limit}`}${offset === undefined ? '' : ` OFFSET ${offset}`}`,

  quoteQualifiedName: quotePostgresQualifiedName,
  // Postgres folds unquoted names to lower case and reserves words like `user`.
  columnReference: (column: string, source?: string) =>
    `${source ? `${quotePostgresQualifiedName(source)}.` : ''}${quotePostgresIdentifier(column)}`,
  // No `finalTable`: Postgres has no row-version modifier, so datasets
  // declared `final: true` are refused rather than read unresolved.
  rawSqlExpressionError(sql: string) {
    let code: string;
    try {
      code = stripPostgresLiterals(sql);
    } catch {
      return 'unterminated-literal';
    }
    return STATEMENT_BREAKERS.test(code) ? 'statement-break' : undefined;
  },

  stringLiteral,
  measureFilterLiteral(value: unknown): string {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return stringLiteral(value);
    if (typeof value === 'number') return finiteNumber(value, 'A measure filter');
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    throw new Error(`Unsupported literal type in measure filter: ${typeof value}`);
  },

  truncateTime,
  addTime,
  subtractTime,
  timeDiff,
  toQueryTimezone,
  parseTimestamp,
  // A bare time column (`date`, `timestamp` assumed UTC, or `timestamptz`)
  // against a timestamptz value: the probe is an uncorrelated zero-row
  // subquery, run once, so the right side is constant and the column's index
  // applies. A `date` holds local dates, so its wall clock is read as UTC.
  queryTimeValue: (value: string, timezone: string, probe: string) =>
    `(CASE WHEN pg_typeof(${probe}) = 'date'::regtype THEN CAST(${value} AS timestamp) AT TIME ZONE 'UTC' `
    + `ELSE CAST(${value} AS timestamp) AT TIME ZONE ${stringLiteral(timezone)} END)`,
  // Converted times are wall clocks without a zone; the zone is the query's.
  timezoneOf: (_time: string, timezone: string) => stringLiteral(timezone),
  clockPart: (part, time) => `FLOOR(EXTRACT(${part.toUpperCase()} FROM ${time}))::int`,
  isDateOnlyType: (value: string) => `(pg_typeof(${value}) = 'date'::regtype)`,
  periodValue,

  // See guard-errors.ts: 0, or an error carrying the message.
  guard: (condition: string, message: string) =>
    `CAST(CASE WHEN ${condition} THEN ${stringLiteral(GUARD_PREFIX + message)} ELSE '0' END AS integer)`,
  ifElse: (condition: string, then: string, otherwise: string) => `CASE WHEN ${condition} THEN ${then} ELSE ${otherwise} END`,
  booleanLiteral: (value: boolean) => value ? 'TRUE' : 'FALSE',
  greatest: (...values: string[]) => `GREATEST(${values.join(', ')})`,
  least: (...values: string[]) => `LEAST(${values.join(', ')})`,
  isNotDistinctFrom: (left: string, right: string) => `(${left} IS NOT DISTINCT FROM ${right})`,
  isNotNull: (value: string) => `(${value} IS NOT NULL)`,
  assumeNotNull: (value: string) => value,
  toNullable: (value: string) => value,
  countIf: (condition: string) => `COUNT(*) FILTER (WHERE ${condition})`,
  seriesIndex: (count: string) => `generate_series(0, (${count}) - 1)`,
  anyIndex: (index: string, count: string, predicate: string) =>
    `EXISTS (SELECT 1 FROM generate_series(0, (${count}) - 1) AS _hq_index_series(${index}) WHERE ${predicate})`,

  // An anonymous ROW compares, groups and partitions, but its fields cannot
  // be read back by position, so isolated columns are separate columns.
  packRow: (values: readonly string[]) => `ROW(${values.join(', ')})`,
  // Postgres does not resolve a SELECT alias inside a sibling expression,
  // so plain prefixed aliases cannot capture authored names.
  isolateColumns: (rowAlias: string, values: readonly string[]) =>
    values.map((value, index) => `${value} AS ${rowAlias}_${index + 1}`),
  isolatedColumn: (rowAlias: string, position: number) => `${rowAlias}_${position}`,
  isolatedColumnProbe: (rowAlias: string, relation: string, position: number) =>
    `(SELECT ${rowAlias}_${position} FROM ${relation} LIMIT 0)`,
  selectAllExcept: (_relation: string, _excluded: readonly string[], kept: readonly string[]) => kept.join(', '),
  derivedTable: (sql: string, alias: string) => `(${sql}) AS ${alias}`,
  // Postgres SELECT aliases are not visible to sibling items: chain one
  // lateral step per item, each reading the columns of the steps before it.
  selectWithAliasReferences: items => `SELECT * FROM ${items
    .map(([expression, alias], index) => `${index ? 'CROSS JOIN LATERAL ' : ''}(SELECT ${expression} AS ${alias}) AS _hq_step${index}`)
    .join(' ')}`,
  // ClickHouse ASOF: the nearest earlier right row, found by an indexed lateral probe.
  asofLeftJoin: (relation, alias, equalities, before) => `LEFT JOIN LATERAL (SELECT * FROM ${relation} AS ${alias} WHERE ${
    [...equalities.map(([left, right]) => `${left} IS NOT DISTINCT FROM ${right}`), `${before[0]} > ${before[1]}`].join(' AND ')
  } ORDER BY ${before[1]} DESC LIMIT 1) AS ${alias} ON TRUE`,

  filteredAggregateInput: (condition: string, value: string, fallback: '0' | 'NULL') =>
    `CASE WHEN ${condition} THEN ${value} ELSE ${fallback} END`,
  windowAggregate(definition, value, arg) {
    switch (definition.aggregation) {
      case 'count': return `COUNT(${value})`;
      case 'countDistinct':
      case 'approxCountDistinct': return `COUNT(DISTINCT ${value})`;
      case 'sum': return `SUM(${value})`;
      case 'avg': return `AVG(${value})`;
      case 'min': return `MIN(${value})`;
      case 'max': return `MAX(${value})`;
      case 'percentile': return percentileSql(value, definition.level ?? Number.NaN);
      case 'argMax': return argExtremeSql(value, arg, 'DESC');
      case 'argMin': return argExtremeSql(value, arg, 'ASC');
      case 'stddev': return `stddev_samp(${value})`;
      case 'variance': return `var_samp(${value})`;
      default: return unsupported(`The "${definition.aggregation}" aggregation`);
    }
  },
  // Cumulative windows re-aggregate partial sums, minimums and maximums.
  reaggregate(aggregation, value) {
    switch (aggregation) {
      case 'sum': return `SUM(${value})`;
      case 'min': return `MIN(${value})`;
      case 'max': return `MAX(${value})`;
      default: return unsupported(`Cumulative "${aggregation}"`);
    }
  },

  formulaLiteral(value) {
    if (value === null) return 'NULL';
    if (typeof value === 'number') return finiteNumber(value, 'A formula');
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return stringLiteral(value);
  },
  formulaBinary(operator, left, right) {
    const symbol = BINARY_OPERATORS[operator];
    if (!symbol) throw new Error('Formula contains an unsupported binary operator.');
    // ClickHouse `/` is always floating point; Postgres truncates bigint / bigint.
    if (operator === 'divide') return `(CAST(${left} AS double precision) / ${right})`;
    return `(${left} ${symbol} ${right})`;
  },
  formulaFunction(name, args) {
    switch (name) {
      case 'nullIfZero': return `NULLIF(${args[0]}, 0)`;
      case 'coalesce': return `COALESCE(${args.join(', ')})`;
      case 'round': return roundSql(args[0]!, args[1]);
      case 'floor': return `FLOOR(${args[0]})`;
      case 'ceil': return `CEIL(${args[0]})`;
      default: throw new Error('Formula contains an unsupported function.');
    }
  },
});

const zoned = new Map<string, DatasetSqlDialectRules>();

/** The rules for planning on instants in `timezone`. Memoized per zone. */
function zonedRules(timezone: string): DatasetSqlDialectRules {
  let rules = zoned.get(timezone);
  if (!rules) {
    rules = defineDatasetSqlDialectRules({ ...postgresDatasetSqlDialect, ...zonedTimeRules(timezone) });
    zoned.set(timezone, rules);
  }
  return rules;
}
