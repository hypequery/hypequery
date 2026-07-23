import { splitSqlPlaceholders } from './utils/sql-parens.js';

export function escapeValue(value: unknown): string {
  if (value === null) {
    return 'NULL';
  } else if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot render a non-finite number as a SQL parameter');
    }
    return value.toString();
  } else if (typeof value === 'bigint') {
    return value.toString();
  } else if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
    return `'${escaped}'`;
  } else if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error('Cannot render an invalid Date as a SQL parameter');
    }
    return `'${value.toISOString()}'`;
  } else {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error(`Cannot render ${typeof value} as a SQL parameter`);
    }
    // JSON is still carried inside a ClickHouse string literal. Route it
    // through the same escaping as any other string so quotes in nested values
    // cannot terminate that literal.
    return escapeValue(serialized);
  }
}

export function substituteParameters(sql: string, params: readonly unknown[]): string {
  const parts = splitSqlPlaceholders(sql);
  if (parts.length - 1 !== params.length) {
    throw new Error(`Mismatch between placeholders and parameters. Found ${parts.length - 1} placeholders but ${params.length} parameters.`);
  }

  let substitutedSql = '';
  for (let i = 0; i < params.length; i++) {
    substitutedSql += parts[i] + escapeValue(params[i]);
  }
  substitutedSql += parts[parts.length - 1];

  return substitutedSql;
} 
