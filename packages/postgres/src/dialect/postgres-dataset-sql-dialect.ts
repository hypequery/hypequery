import { defineDatasetSqlDialectRules, type DatasetSqlDialectRules } from '@hypequery/datasets/internal';
import { quotePostgresIdentifier, quotePostgresQualifiedName } from '../utils/identifiers.js';
import { orderTerm } from '../compiler/compile-select.js';
import { stripPostgresLiterals } from './strip-literals.js';
import { addTime, subtractTime, timeDiff, toQueryTimezone, truncateTime } from './postgres-time-sql.js';

/** Statement terminators and comment openers outside literals. */
const STATEMENT_BREAKERS = /;|--|\/\*/;

/**
 * Time measures (trailing, toDate, cumulative, shift, and formulas over
 * them) are planned around ClickHouse primitives with no single Postgres
 * expression: ASOF joins, `EXCEPT` column lists, typed tuple access and
 * in-expression errors. They are refused on Postgres until the time-measure
 * planner gains engine-neutral forms.
 */
function unsupported(primitive: string): never {
  throw new Error(
    `Time measures (trailing, toDate, cumulative, shift) are not supported on Postgres yet (needs ${primitive}).`,
  );
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
 * Postgres spelling for everything the datasets planner emits. Results match
 * ClickHouse: division is floating point (Postgres truncates integer
 * division), NULLs sort last in both directions, weeks start on Sunday.
 */
export const postgresDatasetSqlDialect: DatasetSqlDialectRules = defineDatasetSqlDialectRules({
  name: 'postgres',
  quoteIdentifier: quotePostgresIdentifier,

  placeholder: (index: number) => `$${index + 1}`,
  reusesPlaceholders: true,
  embedsPositionalPieces: false,

  orderTerm: (expression: string, direction?: 'ASC' | 'DESC') => orderTerm({ expression, direction }),
  paginate: (limit: number | undefined, offset: number | undefined) =>
    `${limit === undefined ? '' : ` LIMIT ${limit}`}${offset === undefined ? '' : ` OFFSET ${offset}`}`,

  quoteQualifiedName: quotePostgresQualifiedName,
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
  parseTimestamp: () => unsupported('a timestamp parsed in a zone read from data'),
  timezoneOf: () => unsupported('the time zone of a value'),
  clockPart: (part, time) => `EXTRACT(${part.toUpperCase()} FROM ${time})::int`,
  isDateOnlyType: (value: string) => `(pg_typeof(${value}) = 'date'::regtype)`,

  guard: () => unsupported('an in-expression error'),
  ifElse: (condition: string, then: string, otherwise: string) => `CASE WHEN ${condition} THEN ${then} ELSE ${otherwise} END`,
  greatest: (...values: string[]) => `GREATEST(${values.join(', ')})`,
  least: (...values: string[]) => `LEAST(${values.join(', ')})`,
  isNotDistinctFrom: (left: string, right: string) => `(${left} IS NOT DISTINCT FROM ${right})`,
  isNotNull: (value: string) => `(${value} IS NOT NULL)`,
  assumeNotNull: (value: string) => value,
  toNullable: (value: string) => value,
  countIf: (condition: string) => `COUNT(*) FILTER (WHERE ${condition})`,
  seriesIndex: (count: string) => `generate_series(0, (${count}) - 1)`,
  anyIndex: (index: string, count: string, predicate: string) =>
    `EXISTS (SELECT 1 FROM generate_series(0, (${count}) - 1) AS _hq_series(${index}) WHERE ${predicate})`,

  // An anonymous ROW is comparable and countable (COUNT(DISTINCT ROW(a, b)))
  // but its fields cannot be read back by position.
  packRow: (values: readonly string[]) => `ROW(${values.join(', ')})`,
  rowElement: () => unsupported('positional access into a packed row'),
  selectAllExcept: () => unsupported('a column list with exclusions'),
  get asofLeftJoin(): string {
    return unsupported('an ASOF join');
  },

  filteredAggregateInput: (condition: string, value: string, fallback: '0' | 'NULL') =>
    `CASE WHEN ${condition} THEN ${value} ELSE ${fallback} END`,
  windowAggregate: () => unsupported('window aggregates'),
  reaggregate(aggregation, value) {
    switch (aggregation) {
      case 'sum': return `SUM(${value})`;
      case 'min': return `MIN(${value})`;
      case 'max': return `MAX(${value})`;
      default: return unsupported(`re-aggregation of ${aggregation}`);
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
      // Postgres has ROUND(numeric, int) but no ROUND(double precision, int).
      case 'round': return args.length > 1
        ? `CAST(ROUND(CAST(${args[0]} AS numeric), ${args[1]}) AS double precision)`
        : `ROUND(${args[0]})`;
      case 'floor': return `FLOOR(${args[0]})`;
      case 'ceil': return `CEIL(${args[0]})`;
      default: throw new Error('Formula contains an unsupported function.');
    }
  },
});
