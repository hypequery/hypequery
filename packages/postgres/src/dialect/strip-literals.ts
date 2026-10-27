/** Why a raw expression can't be lexed safely. */
export class PostgresLexError extends Error {
  constructor(readonly kind: 'unterminated-literal' | 'ambiguous', message: string) {
    super(message);
  }
}

/**
 * Blank every literal and quoted identifier in a Postgres expression,
 * keeping its length, so a scanner can look for statement breakers outside
 * them. Throws a {@link PostgresLexError} on an unterminated literal, or on a
 * construct whose lexing depends on rules that differ between Postgres
 * versions, so this scanner and the server could disagree about where a
 * literal ends.
 *
 * Postgres lexing that differs from ClickHouse:
 * - `'…'` escapes a quote only by doubling it; a backslash is data
 *   (`standard_conforming_strings`, which the driver pins on).
 * - `E'…'` also treats backslash as an escape, but only when the `E` starts a
 *   token: not when it ends an identifier. One glued to a number is refused.
 * - A string followed by whitespace containing a newline and another quote
 *   continues, in the first part's mode. A continued `E'…'` is refused.
 * - `"…"` identifiers double their quotes.
 * - Non-ASCII characters are identifier characters.
 * - `$` starts dollar-quoted strings (`$tag$…$tag$`) and parameters (`$1`),
 *   and continues identifiers. None belongs in a dataset expression, so `$`
 *   outside a literal is refused.
 */
export function stripPostgresLiterals(sql: string): string {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === '$') {
      throw new PostgresLexError('ambiguous', '"$" outside a quoted literal (dollar quotes, parameters).');
    }
    if (char === "'") {
      const escapeString = isEscapeStringPrefix(sql, index);
      const end = quotedEnd(sql, index, "'", escapeString);
      if (escapeString && CONTINUATION.test(sql.slice(end))) {
        throw new PostgresLexError('ambiguous', "an E'…' string followed by another quoted string.");
      }
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
    out += char;
    index += 1;
  }
  return out;
}

/** Whitespace then a quote: a possible string continuation (any whitespace, so every version's rule is covered). */
const CONTINUATION = /^\s*'/;

/**
 * Whether the quote opens an `E'…'` string: an `E` that starts a token. An `E`
 * ending an identifier (`typE'…'`, `date'…'`) is part of it, and the string is
 * standard. An `E` glued to a number is refused: `1E'…'` is an escape string
 * on Postgres 14 and an error on 18, and `1_0E'…'` depends on the version too.
 */
function isEscapeStringPrefix(sql: string, quoteIndex: number): boolean {
  const prefix = sql[quoteIndex - 1];
  if (prefix !== 'E' && prefix !== 'e') return false;
  let start = quoteIndex - 1;
  while (isIdentifierChar(sql[start - 1])) start -= 1;
  if (start === quoteIndex - 1) return true;
  if (/[A-Za-z_\u0080-\uffff]/.test(sql[start]!)) return false;
  throw new PostgresLexError('ambiguous', `a quoted string glued to a number ending in "${prefix}".`);
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
  throw new PostgresLexError('unterminated-literal', 'Unterminated quoted literal.');
}

/** Postgres `ident_cont`: ASCII letters, digits, `_`, `$`, and every non-ASCII character. */
function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
}

function blank(length: number): string {
  return ' '.repeat(length);
}
