export function extractGroupByExpressions(sql: string): string[] {
  const match = sql.match(/\bGROUP BY\b\s+(.+?)(?:\bHAVING\b|\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)/is);
  if (!match) {
    return [];
  }

  return match[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

export function validateDerivedCteGrouping(
  sql: string,
  aggregateAliases: string[],
  intendedGroupBy: string[],
): string[] {
  const errors: string[] = [];
  const actualGroupBy = extractGroupByExpressions(sql);

  if (intendedGroupBy.length === 0 && actualGroupBy.length > 0) {
    errors.push('Derived metric planner emitted GROUP BY for an ungrouped query.');
  }

  const duplicates = actualGroupBy.filter((expression, index) => actualGroupBy.indexOf(expression) !== index);
  if (duplicates.length > 0) {
    errors.push(
      `Derived metric planner emitted duplicate GROUP BY expressions: ${Array.from(new Set(duplicates)).join(', ')}`,
    );
  }

  const aggregateAliasSet = new Set(aggregateAliases);
  const aggregateAliasesInGroupBy = actualGroupBy.filter(expression => aggregateAliasSet.has(expression));
  if (aggregateAliasesInGroupBy.length > 0) {
    errors.push(
      `Derived metric planner emitted aggregate aliases in GROUP BY: ${Array.from(new Set(aggregateAliasesInGroupBy)).join(', ')}`,
    );
  }

  const intendedGroupBySet = new Set(intendedGroupBy);
  const unexpectedGroupBy = actualGroupBy.filter(expression => !intendedGroupBySet.has(expression));
  if (unexpectedGroupBy.length > 0) {
    errors.push(
      `Derived metric planner emitted unexpected GROUP BY expressions: ${Array.from(new Set(unexpectedGroupBy)).join(', ')}`,
    );
  }

  return errors;
}
