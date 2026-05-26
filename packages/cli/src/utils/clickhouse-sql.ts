export function quoteIdentifier(identifier: string): string {
  assertValidIdentifier(identifier);
  return `\`${identifier.replace(/`/g, '``')}\``;
}

export function assertValidIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid ClickHouse identifier: ${identifier}`);
  }
}

export function sqlString(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function sqlStringArray(values: string[]) {
  return `[${values.map(sqlString).join(', ')}]`;
}

export function sqlDateTime(value: Date) {
  return `parseDateTime64BestEffort(${sqlString(value.toISOString())}, 3)`;
}
