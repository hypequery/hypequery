/** Compare identifiers by name, whether or not the planner or builder quoted them. */
function identifierName(expression: string): string {
  const quote = expression[0];
  if ((quote === '`' || quote === '"') && expression.length > 1 && expression.endsWith(quote)) {
    return expression.slice(1, -1).split(quote + quote).join(quote);
  }
  return expression;
}

const GROUP_BY_START = /^GROUP\s+BY\b/i;
const GROUP_BY_END = /^(?:HAVING|ORDER\s+BY|LIMIT|OFFSET)\b/i;

/** Index just past the quoted identifier or string at `index`, or `index` when none starts there. */
function skipQuoted(sql: string, index: number): number {
  const quote = sql[index];
  if (quote !== '`' && quote !== '"' && quote !== "'") return index;
  let i = index + 1;
  while (i < sql.length) {
    if (sql[i] === '\\') { i += 2; continue; }
    if (sql[i] === quote) {
      if (sql[i + 1] !== quote) return i + 1;
      i += 2;
      continue;
    }
    i++;
  }
  return i;
}

/**
 * The top-level GROUP BY terms of a statement. Scans rather than matching a
 * regex, so quoted names (`limit`), string literals and nested calls with
 * commas neither end the clause nor split a term.
 */
export function extractGroupByExpressions(sql: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let termStart = -1;
  let i = 0;
  while (i < sql.length) {
    const quotedEnd = skipQuoted(sql, i);
    if (quotedEnd > i) { i = quotedEnd; continue; }
    const char = sql[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0) {
      const atWord = /[A-Za-z]/.test(char) && (i === 0 || !/[\w$]/.test(sql[i - 1]));
      if (termStart < 0 && atWord) {
        const start = sql.slice(i).match(GROUP_BY_START);
        if (start) { i += start[0].length; termStart = i; continue; }
      } else if (termStart >= 0 && atWord && GROUP_BY_END.test(sql.slice(i))) {
        break;
      } else if (termStart >= 0 && char === ',') {
        terms.push(sql.slice(termStart, i));
        termStart = i + 1;
      }
    }
    i++;
  }
  if (termStart < 0) return [];
  terms.push(sql.slice(termStart, i));
  return terms.map(term => term.trim()).filter(Boolean);
}

export function validateDerivedCteGrouping(
  sql: string,
  aggregateAliases: string[],
  intendedGroupBy: string[],
): string[] {
  const errors: string[] = [];
  const actualGroupBy = extractGroupByExpressions(sql).map(identifierName);
  aggregateAliases = aggregateAliases.map(identifierName);
  intendedGroupBy = intendedGroupBy.map(identifierName);

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
