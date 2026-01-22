export function escapeValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  return `'${JSON.stringify(value)}'`;
}

export function substituteParameters(sql: string, params: Record<string, any> = {}): string {
  const matches = sql.match(/:(\w+)/g) ?? [];
  const uniqueParams = new Set(matches);

  for (const param of uniqueParams) {
    const key = param.slice(1);
    if (!(key in params)) {
      throw new Error(`Missing value for parameter :${key}`);
    }
    const value = escapeValue(params[key]);
    const regex = new RegExp(`${param}(?![A-Za-z0-9_])`, 'g');
    sql = sql.replace(regex, value);
  }

  const unconsumedKeys = Object.keys(params).filter((key) => !uniqueParams.has(`:${key}`));
  if (unconsumedKeys.length > 0) {
    throw new Error(`Unused parameter(s): ${unconsumedKeys.join(', ')}`);
  }

  return sql;
}
