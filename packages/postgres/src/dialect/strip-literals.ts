/**
 * Blank every literal and quoted identifier in a Postgres expression,
 * keeping its length, so a scanner can look for statement breakers outside
 * them. Throws on an unterminated literal.
 *
 * Postgres lexing that differs from ClickHouse:
 * - `'…'` escapes a quote only by doubling it; a backslash is data
 *   (`standard_conforming_strings`, which the driver pins on).
 * - `E'…'` also treats backslash as an escape.
 * - `$tag$…$tag$` dollar-quoted strings, where `tag` may be empty. `$1` is a
 *   parameter, not a dollar quote: a tag cannot start with a digit.
 * - `"…"` identifiers double their quotes.
 */
export function stripPostgresLiterals(sql: string): string {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === "'") {
      const escapeString = isEscapeStringPrefix(sql, index);
      const end = quotedEnd(sql, index, "'", escapeString);
      out += blank(end - index);
      index = end;
      continue;
    }
    if (char === '"') {
      const end = quotedEnd(sql, index, '"', false);
      out += blank(end - index);
      index = end;
      continue;
    }
    if (char === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (tag && !isIdentifierChar(sql[index - 1])) {
        const close = sql.indexOf(tag[0], index + tag[0].length);
        if (close < 0) throw new Error('Unterminated dollar-quoted string.');
        const end = close + tag[0].length;
        out += blank(end - index);
        index = end;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

/** `E'` / `e'` not glued to a preceding identifier. */
function isEscapeStringPrefix(sql: string, quoteIndex: number): boolean {
  const prefix = sql[quoteIndex - 1];
  return (prefix === 'E' || prefix === 'e') && !isIdentifierChar(sql[quoteIndex - 2]);
}

/** Index just past the closing quote. */
function quotedEnd(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index]!;
    if (backslashEscapes && char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  throw new Error('Unterminated quoted literal.');
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function blank(length: number): string {
  return ' '.repeat(length);
}
