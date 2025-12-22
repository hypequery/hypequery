import { TableColumn } from '../../types/schema.js';

export type PredicatePrimitive = string | number | boolean | Date | null;
type PredicateValue = Exclude<PredicatePrimitive, string>;

export interface PredicateExpression<T = unknown> {
  __type: 'predicate_expression';
  sql: string;
  parameters: any[];
  // Phantom property for type inference
  readonly expressionType?: T | undefined;
}

export interface PredicateLiteral<T = PredicatePrimitive> {
  __type: 'predicate_literal';
  value: T;
}

export type ColumnReference<Schema, OriginalT> = keyof OriginalT | TableColumn<Schema>;

export type PredicateArg<Schema, OriginalT> =
  | ColumnReference<Schema, OriginalT>
  | PredicateExpression
  | PredicateLiteral
  | PredicateValue
  | PredicatePrimitive[];

export interface PredicateBuilder<Schema, OriginalT> {
  fn<T = unknown>(name: string, ...args: Array<PredicateArg<Schema, OriginalT>>): PredicateExpression<T>;
  col(column: ColumnReference<Schema, OriginalT>): PredicateExpression;
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

function normalizeArgument<Schema, OriginalT>(
  arg: PredicateArg<Schema, OriginalT>
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

function buildFunctionExpression<Schema, OriginalT, T = unknown>(
  name: string,
  args: PredicateArg<Schema, OriginalT>[]
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

export function createPredicateBuilder<Schema, OriginalT>(): PredicateBuilder<Schema, OriginalT> {
  return {
    fn: <T = unknown>(name: string, ...args: Array<PredicateArg<Schema, OriginalT>>) =>
      buildFunctionExpression<Schema, OriginalT, T>(name, args),
    col: column => createExpression(String(column)),
    value: value => literal(value),
    literal: value => literal(value),
    array: values => buildArrayLiteral(values),
    raw: sql => createExpression(sql),
    and: expressions => buildLogical('AND', expressions),
    or: expressions => buildLogical('OR', expressions)
  };
}
