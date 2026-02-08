export function escapeValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  else if (typeof value === 'number') {
    return value.toString();
  } else if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  } else if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  } else {
    return `'${JSON.stringify(value)}'`;
  }
}

export function substituteParameters(sql: string, params: any[]): string {
  if (!params.length) {
    return sql;
  }
  const parts = sql.split('?');
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
