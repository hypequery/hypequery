const WORD_CHAR = /[A-Za-z0-9_$]/;
const HEREDOC_TAG_CHAR = /[A-Za-z0-9_]/;

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

function skipUnicodeQuoted(sql: string, start: number, closingQuote: string): number {
  const closing = sql.indexOf(closingQuote, start + 1);
  return closing === -1 ? sql.length : closing + 1;
}

function skipLineComment(sql: string, start: number): number {
  const newline = sql.indexOf('\n', start + 2);
  return newline === -1 ? sql.length : newline + 1;
}

function skipBlockComment(sql: string, start: number): number {
  let depth = 1;
  let i = start + 2;
  while (i < sql.length) {
    if (sql.startsWith('/*', i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (sql.startsWith('*/', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return i;
}

function skipHeredoc(sql: string, start: number): number | undefined {
  let tagEnd = start + 1;
  while (tagEnd < sql.length && sql[tagEnd] !== '$') {
    if (!HEREDOC_TAG_CHAR.test(sql[tagEnd]!)) return undefined;
    tagEnd += 1;
  }
  if (tagEnd >= sql.length) return undefined;

  const delimiter = sql.slice(start, tagEnd + 1);
  const closing = sql.indexOf(delimiter, tagEnd + 1);
  return closing === -1 ? undefined : closing + delimiter.length;
}

function isLineCommentStart(sql: string, start: number): boolean {
  if (sql.startsWith('--', start) || sql.startsWith('//', start)) return true;
  return sql[start] === '#' && (sql[start + 1] === ' ' || sql[start + 1] === '!');
}

function skipNonCode(sql: string, start: number): number | undefined {
  const ch = sql[start]!;
  if (ch === "'" || ch === '"' || ch === '`') {
    return skipQuoted(sql, start, ch);
  }
  if (ch === '\u2018') {
    return skipUnicodeQuoted(sql, start, '\u2019');
  }
  if (ch === '\u201c') {
    return skipUnicodeQuoted(sql, start, '\u201d');
  }
  if (ch === '$') {
    return skipHeredoc(sql, start);
  }
  if (sql.startsWith('/*', start)) {
    return skipBlockComment(sql, start);
  }
  if (isLineCommentStart(sql, start)) {
    return skipLineComment(sql, start);
  }
  return undefined;
}

function matchingCloser(ch: string): string | undefined {
  if (ch === '(') return ')';
  if (ch === '[') return ']';
  if (ch === '{') return '}';
  return undefined;
}

/**
 * Split on positional parameter markers that occur in SQL code. Question marks
 * inside literals, quoted identifiers, heredocs, or comments are data, not
 * placeholders, and must not affect parameter binding.
 */
export function splitSqlPlaceholders(sql: string): string[] {
  const parts: string[] = [];
  let partStart = 0;
  let i = 0;

  while (i < sql.length) {
    const skippedTo = skipNonCode(sql, i);
    if (skippedTo !== undefined) {
      i = skippedTo;
      continue;
    }

    if (sql[i] === '?') {
      parts.push(sql.slice(partStart, i));
      partStart = i + 1;
    }
    i += 1;
  }

  parts.push(sql.slice(partStart));
  return parts;
}

/**
 * A generated separator appended after an unterminated line comment would be
 * swallowed by that comment. Add a newline only when the fragment ends inside
 * a ClickHouse line comment so it remains safe to compose with generated SQL.
 */
export function terminateTrailingLineComment(sql: string): string {
  let i = 0;
  while (i < sql.length) {
    if (isLineCommentStart(sql, i)) {
      const newline = sql.indexOf('\n', i + 2);
      if (newline === -1) return `${sql}\n`;
      i = newline + 1;
      continue;
    }

    const skippedTo = skipNonCode(sql, i);
    i = skippedTo === undefined ? i + 1 : skippedTo;
  }
  return sql;
}

/**
 * True when the fragment contains an AND/OR at paren depth 0 (outside string
 * literals, heredocs, comments, and nested delimiters), i.e. embedding it next
 * to other conditions without parentheses would change how the surrounding
 * WHERE parses.
 */
export function hasTopLevelLogicalOperator(sql: string): boolean {
  const closers: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const skippedTo = skipNonCode(sql, i);
    if (skippedTo !== undefined) {
      i = skippedTo;
      continue;
    }

    const closer = matchingCloser(ch);
    if (closer) {
      closers.push(closer);
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (closers[closers.length - 1] === ch) closers.pop();
      i += 1;
      continue;
    }
    if (closers.length === 0 && (i === 0 || !WORD_CHAR.test(sql[i - 1]!))) {
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
  const closers: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    const skippedTo = skipNonCode(trimmed, i);
    if (skippedTo !== undefined) {
      i = skippedTo;
      continue;
    }

    const closer = matchingCloser(ch);
    if (closer) {
      closers.push(closer);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (closers.pop() !== ch) return false;
      if (closers.length === 0) return i === trimmed.length - 1;
    }
    i += 1;
  }
  return false;
}
