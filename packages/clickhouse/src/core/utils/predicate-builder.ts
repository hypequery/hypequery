import { TableColumnForTables } from '../../types/schema.js';
import type { AnyBuilderState, BaseRow } from '../types/builder-state.js';

export type PredicatePrimitive = string | number | boolean | Date | null;
type PredicateValue = Exclude<PredicatePrimitive, string>;

export interface PredicateExpression<T = unknown> {
  __type: 'predicate_expression';
  sql: string;
  parameters: any[];
  readonly expressionType?: T | undefined;
}

export interface PredicateLiteral<T = PredicatePrimitive> {
  __type: 'predicate_literal';
  value: T;
}

export type ColumnReference<State extends AnyBuilderState> =
  | keyof BaseRow<State>
  | keyof State['output']
  | TableColumnForTables<State['schema'], State['tables']>;

export type PredicateArg<State extends AnyBuilderState> =
  | ColumnReference<State>
  | PredicateExpression
  | PredicateLiteral
  | PredicateValue
  | PredicatePrimitive[];

export interface PredicateBuilder<State extends AnyBuilderState> {
  fn<T = unknown>(name: string, ...args: Array<PredicateArg<State>>): PredicateExpression<T>;
  col(column: ColumnReference<State>): PredicateExpression;
  value<T extends PredicatePrimitive>(value: T): PredicateLiteral<T>;
  literal<T extends PredicatePrimitive>(value: T): PredicateLiteral<T>;
  array(values: Array<PredicatePrimitive | PredicateLiteral>): PredicateExpression;
  raw(sql: string): PredicateExpression;
  and(expressions: PredicateExpression[]): PredicateExpression<boolean>;
  or(expressions: PredicateExpression[]): PredicateExpression<boolean>;
}

function createExpression<T = unknown>(sql: string, parameters: any[] = []): PredicateExpression<T> {
  return {
    __type: 'predicate_expression',
    sql,
    parameters,
    expressionType: undefined as T | undefined
  };
}

function literal<T extends PredicatePrimitive>(value: T): PredicateLiteral<T> {
  return {
    __type: 'predicate_literal',
    value
  };
}

function isPredicateExpression(value: any): value is PredicateExpression {
  return value?.__type === 'predicate_expression';
}

function isPredicateLiteral(value: any): value is PredicateLiteral {
  return value?.__type === 'predicate_literal';
}

function buildArrayLiteral(values: Array<PredicatePrimitive | PredicateLiteral>): PredicateExpression {
  const parts: string[] = [];
  const parameters: any[] = [];

  values.forEach(value => {
    const normalized = normalizeLiteralValue(value);
    parts.push(normalized.sql);
    parameters.push(...normalized.parameters);
  });

  return createExpression(`[${parts.join(', ')}]`, parameters);
}

function normalizeLiteralValue(value: PredicatePrimitive | PredicateLiteral): PredicateExpression {
  if (isPredicateLiteral(value)) {
    return createExpression('?', [value.value]);
  }

  if (value === null) {
    return createExpression('NULL');
  }

  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return createExpression('?', [value]);
  }

  throw new Error('Unsupported literal value in predicate array');
}

function normalizeArgument<State extends AnyBuilderState>(
  arg: PredicateArg<State>
): PredicateExpression {
  if (isPredicateExpression(arg)) {
    return arg;
  }

  if (isPredicateLiteral(arg)) {
    return createExpression('?', [arg.value]);
  }

  if (Array.isArray(arg)) {
    return buildArrayLiteral(arg);
  }

  if (arg === null) {
    return createExpression('NULL');
  }

  if (arg instanceof Date || typeof arg === 'number' || typeof arg === 'boolean') {
    return createExpression('?', [arg]);
  }

  if (typeof arg === 'string') {
    return createExpression(arg);
  }

  throw new Error('Unsupported predicate argument type');
}

function buildFunctionExpression<State extends AnyBuilderState, T = unknown>(
  name: string,
  args: PredicateArg<State>[]
): PredicateExpression<T> {
  const builtArgs = args.map(arg => normalizeArgument(arg));
  const sql = `${name}(${builtArgs.map(arg => arg.sql).join(', ')})`;
  const parameters = builtArgs.flatMap(arg => arg.parameters);
  return createExpression(sql, parameters);
}

function buildLogical(operator: 'AND' | 'OR', expressions: PredicateExpression[]): PredicateExpression<boolean> {
  if (!expressions.length) {
    throw new Error(`${operator} requires at least one expression`);
  }
  if (expressions.length === 1) {
    return expressions[0] as PredicateExpression<boolean>;
  }

  const sql = expressions.map(expr => `(${expr.sql})`).join(` ${operator} `);
  const parameters = expressions.flatMap(expr => expr.parameters);
  return createExpression(sql, parameters);
}

export function createPredicateBuilder<State extends AnyBuilderState>(): PredicateBuilder<State> {
  return {
    fn: <T = unknown>(name: string, ...args: Array<PredicateArg<State>>) =>
      buildFunctionExpression<State, T>(name, args),
    col: column => createExpression(String(column)),
    value: value => literal(value),
    literal: value => literal(value),
    array: values => buildArrayLiteral(values),
    raw: sql => createExpression(sql),
    and: expressions => buildLogical('AND', expressions),
    or: expressions => buildLogical('OR', expressions)
  };
}
