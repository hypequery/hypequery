import type { DatasetSqlBinaryOperator, DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { TimeGrain } from '../types.js';
import { quoteSQLIdentifier, stripSqlLiterals } from '../sql-utils.js';

const TRUNCATE_FUNCTIONS: Record<TimeGrain, string> = {
  minute: 'toStartOfMinute',
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
  // Mode 0 (Sunday) is the shipped behaviour; Monday weeks wait for a major.
  week: 'toStartOfWeek',
  month: 'toStartOfMonth',
  quarter: 'toStartOfQuarter',
  year: 'toStartOfYear',
};

const INTERVAL_UNITS: Record<TimeGrain, string> = {
  minute: 'Minutes', hour: 'Hours', day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years',
};

const BINARY_OPERATORS: Record<DatasetSqlBinaryOperator, string> = {
  add: '+', subtract: '-', multiply: '*', divide: '/',
};

/**
 * Statement terminators and comment openers. A raw `sql` value is spliced into
 * a larger expression, so any of these turns one expression into something
 * else: `;` starts a second statement, `--` and `/*` comment out whatever the
 * builder appends after it.
 */
const STATEMENT_BREAKERS = /;|--|\/\*/;

// ClickHouse also treats backslash as a string escape. Doubling quotes without
// escaping backslashes lets a value ending in \\ before a quote break out of
// the literal and change the predicate.
function stringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Preserve the existing ClickHouse spelling and escaping byte for byte. */
export const clickhouseDatasetSqlDialect: DatasetSqlDialectRules = Object.freeze({
  name: 'clickhouse',
  quoteIdentifier: quoteSQLIdentifier,

  // The adapter substitutes positional `?` on the client, one value per marker.
  placeholder: () => '?',
  reusesPlaceholders: false,
  embedsPositionalPieces: true,

  orderTerm: (expression: string, direction?: 'ASC' | 'DESC') => direction ? `${expression} ${direction}` : expression,
  paginate: (limit: number | undefined, offset: number | undefined) =>
    `${limit === undefined ? '' : ` LIMIT ${limit}`}${offset === undefined ? '' : ` OFFSET ${offset}`}`,

  quoteQualifiedName: (name: string) => name.split('.').map(quoteSQLIdentifier).join('.'),
  finalTable: (quotedSource: string) => `${quotedSource} FINAL`,
  rawSqlExpressionError(sql: string) {
    let code: string;
    try {
      // Quoted spans are blanked first, so a terminator inside a literal is data.
      code = stripSqlLiterals(sql);
    } catch {
      return 'unterminated-literal';
    }
    return STATEMENT_BREAKERS.test(code) ? 'statement-break' : undefined;
  },

  stringLiteral,
  measureFilterLiteral(value: unknown): string {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return stringLiteral(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid non-finite numeric literal in measure filter: ${value}`);
      }
      return String(value);
    }
    if (typeof value === 'boolean') return value ? '1' : '0';
    throw new Error(`Unsupported literal type in measure filter: ${typeof value}`);
  },

  truncateTime: (time: string, grain: TimeGrain) => `${TRUNCATE_FUNCTIONS[grain]}(${time})`,
  addTime: (time: string, amount: string | number, grain: TimeGrain) => `add${INTERVAL_UNITS[grain]}(${time}, ${amount})`,
  subtractTime: (time: string, amount: number, grain: TimeGrain) => `subtract${INTERVAL_UNITS[grain]}(${time}, ${amount})`,
  timeDiff: (grain: TimeGrain, start: string, end: string) => `dateDiff('${grain}', ${start}, ${end})`,
  toQueryTimezone: (time: string, timezone: string) => `toDateTime64(${time}, 9, '${timezone}')`,
  parseTimestamp: (value: string, timezone: string) => `parseDateTime64BestEffort(${value}, 9, ${timezone})`,
  timezoneOf: (time: string) => `timezoneOf(${time})`,
  clockPart: (part, time) => `to${part}(${time})`,
  isDateOnlyType: (value: string) => `position(toTypeName(${value}), 'Date') > 0 AND position(toTypeName(${value}), 'DateTime') = 0`,

  guard: (condition: string, message: string) => `throwIf(${condition}, ${stringLiteral(message)})`,
  ifElse: (condition: string, then: string, otherwise: string) => `if(${condition}, ${then}, ${otherwise})`,
  greatest: (...values: string[]) => `greatest(${values.join(', ')})`,
  least: (...values: string[]) => `least(${values.join(', ')})`,
  isNotDistinctFrom: (left: string, right: string) => `isNotDistinctFrom(${left}, ${right})`,
  isNotNull: (value: string) => `isNotNull(${value})`,
  assumeNotNull: (value: string) => `assumeNotNull(${value})`,
  toNullable: (value: string) => `toNullable(${value})`,
  countIf: (condition: string) => `countIf(${condition})`,
  seriesIndex: (count: string) => `arrayJoin(range(toUInt64(${count})))`,
  anyIndex: (index: string, count: string, predicate: string) => `arrayExists(${index} -> ${predicate}, range(toUInt64(${count})))`,

  packRow: (values: readonly string[]) => `tuple(${values.join(', ')})`,
  rowElement: (row: string, position: number) => `tupleElement(${row}, ${position})`,
  selectAllExcept: (relation: string, columns: readonly string[]) => `${relation}.* EXCEPT (${columns.join(', ')})`,
  asofLeftJoin: 'LEFT ASOF JOIN',

  filteredAggregateInput: (condition: string, value: string, fallback: '0' | 'NULL') => `if(${condition}, ${value}, ${fallback})`,
  windowAggregate(definition, value, arg) {
    switch (definition.aggregation) {
      case 'count': return `count(${value})`;
      case 'countDistinct': return `uniqExact(${value})`;
      case 'approxCountDistinct': return `uniq(${value})`;
      case 'percentile': return `quantileOrNull(${definition.level})(${value})`;
      case 'argMax': return `argMaxOrNull(${value}, ${arg})`;
      case 'argMin': return `argMinOrNull(${value}, ${arg})`;
      case 'stddev': return `stddevSampOrNull(${value})`;
      case 'variance': return `varSampOrNull(${value})`;
      default: return `${definition.aggregation}OrNull(${value})`;
    }
  },
  reaggregate: (aggregation, value) => `${aggregation}OrNull(${value})`,

  formulaLiteral(value) {
    if (value === null) return 'NULL';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Formula contains a non-finite number.');
      return String(value);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return stringLiteral(value);
  },
  formulaBinary(operator, left, right) {
    const symbol = BINARY_OPERATORS[operator];
    if (!symbol) throw new Error('Formula contains an unsupported binary operator.');
    return `(${left} ${symbol} ${right})`;
  },
  formulaFunction(name, args) {
    switch (name) {
      case 'nullIfZero': return `NULLIF(${args[0]}, 0)`;
      case 'coalesce': return `COALESCE(${args.join(', ')})`;
      case 'round': return `ROUND(${args.join(', ')})`;
      case 'floor': return `FLOOR(${args[0]})`;
      case 'ceil': return `CEIL(${args[0]})`;
      default: throw new Error('Formula contains an unsupported function.');
    }
  },
} satisfies DatasetSqlDialectRules);
