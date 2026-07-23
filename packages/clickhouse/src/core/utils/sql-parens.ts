const WORD_CHAR = /[A-Za-z0-9_$]/;

function skipQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return i;
}

/**
 * True when the fragment contains an AND/OR at paren depth 0 (outside string
 * literals and quoted identifiers), i.e. embedding it next to other conditions
 * without parentheses would change how the surrounding WHERE parses.
 */
export function hasTopLevelLogicalOperator(sql: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i, ch);
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0 && (i === 0 || !WORD_CHAR.test(sql[i - 1]!))) {
      const upcoming = sql.slice(i, i + 3).toUpperCase();
      if (upcoming === 'AND' && !WORD_CHAR.test(sql[i + 3] ?? ' ')) return true;
      if (upcoming.startsWith('OR') && !WORD_CHAR.test(sql[i + 2] ?? ' ')) return true;
    }
    i += 1;
  }
  return false;
}

/**
 * True when the fragment is a single parenthesized group, so wrapping it again
 * would only add redundant parentheses.
 */
export function isFullyParenthesized(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return false;
  let depth = 0;
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(trimmed, i, ch);
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i === trimmed.length - 1;
    }
    i += 1;
  }
  return false;
}
