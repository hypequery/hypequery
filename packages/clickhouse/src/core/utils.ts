export function escapeValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  else if (typeof value === 'number') {
    return value.toString();
  } else if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
    return `'${escaped}'`;
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

  // Check if using new typed parameter format {param_N:Type}
  const typedParamRegex = /\{(\w+):[^}]+\}/g;
  const typedMatches = sql.match(typedParamRegex);

  if (typedMatches && typedMatches.length > 0) {
    // New format: replace {param_N:Type} with values
    let result = sql;
    let index = 0;

    result = result.replace(typedParamRegex, () => {
      if (index >= params.length) {
        return '?';
      }
      return escapeValue(params[index++]);
    });

    return result;
  }

  // Old format: replace ? with values
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
