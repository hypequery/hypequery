/**
 * SQL utility functions for safe SQL generation.
 */

/**
 * Validates that a string is a safe SQL identifier (column/table name).
 * Allows only alphanumeric characters and underscores, starting with letter or underscore.
 *
 * @param identifier - The identifier to validate
 * @returns true if valid, false otherwise
 */
export function isSafeSQLIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

/**
 * Validates and throws if identifier is not safe for SQL.
 *
 * @param identifier - The identifier to validate
 * @param context - Context for error message (e.g., "dimension name", "field name")
 * @throws Error if identifier is not safe
 */
export function validateSQLIdentifier(identifier: string, context: string): void {
  if (!isSafeSQLIdentifier(identifier)) {
    throw new Error(
      `Invalid ${context}: "${identifier}". Must contain only letters, numbers, and underscores, ` +
      `and start with a letter or underscore.`
    );
  }
}

/**
 * Quotes a SQL identifier for safe use in queries.
 * Uses backticks, which is how ClickHouse quotes identifiers.
 *
 * @param identifier - The identifier to quote
 * @returns Quoted identifier
 */
export function quoteSQLIdentifier(identifier: string): string {
  // Escape any existing backticks by doubling them
  const escaped = identifier.replace(/`/g, '``');
  return `\`${escaped}\``;
}

/** Quote characters that open a literal or a quoted identifier in ClickHouse. */
const SQL_QUOTES = new Set(["'", '"', '`']);

/** Quotes that delimit an identifier rather than a string literal. */
const IDENTIFIER_QUOTES = new Set(['"', '`']);

export interface StripSqlLiteralsOptions {
  /**
   * Keep the text inside quoted identifiers (`` `col` ``, `"col"`), blanking only
   * the delimiters. String literals are blanked either way.
   *
   * The two callers need different views of the same expression. Finding a
   * statement terminator means finding one that is *syntax*, and a `;` inside
   * `` `odd;name` `` is not — so that check blanks quoted identifiers too.
   * Deciding whether an expression references a column is the opposite: a quoted
   * identifier is exactly such a reference, so that check needs its text.
   */
  readonly keepQuotedIdentifiers?: boolean;
}

/**
 * Blanks out quoted spans in a SQL expression, preserving length and structure.
 *
 * Lexical checks that look for statement terminators or comment openers have to
 * run on code rather than on data: `concat(name, '; ')` and
 * `replaceAll(note, '--', '')` are ordinary expressions whose literals happen to
 * contain those characters. Scanning the raw source text rejects them.
 *
 * Both ClickHouse escape forms are handled: a doubled quote (`'it''s'`) and a
 * backslash escape (`'it\'s'`).
 *
 * @throws Error when a quote is never closed — an unterminated literal is
 * malformed on its own, and treating the remainder as data would let an open
 * quote hide anything after it.
 */
export function stripSqlLiterals(sql: string, options?: StripSqlLiteralsOptions): string {
  let output = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index] as string;
    if (!SQL_QUOTES.has(char)) {
      output += char;
      index += 1;
      continue;
    }

    const quote = char;
    let cursor = index + 1;
    let closed = false;

    while (cursor < sql.length) {
      const current = sql[cursor];
      if (current === '\\') {
        // Backslash escapes the next character, whatever it is.
        cursor += 2;
        continue;
      }
      if (current === quote) {
        if (sql[cursor + 1] === quote) {
          // A doubled quote is an escaped quote, not the end of the span.
          cursor += 2;
          continue;
        }
        closed = true;
        cursor += 1;
        break;
      }
      cursor += 1;
    }

    if (!closed) {
      throw new Error(`Unterminated ${quote} literal in SQL expression.`);
    }

    if (options?.keepQuotedIdentifiers && IDENTIFIER_QUOTES.has(quote)) {
      // Blank only the delimiters, so the identifier stays readable as the
      // column reference it is. Length is preserved either way.
      output += ` ${sql.slice(index + 1, cursor - 1)} `;
    } else {
      // Replace the whole span, quotes included, with spaces so offsets survive.
      output += ' '.repeat(cursor - index);
    }
    index = cursor;
  }

  return output;
}

/**
 * Escapes a string for literal use inside a regular expression.
 *
 * Without this, a value carrying regex syntax either throws at `RegExp`
 * construction or silently matches something other than itself.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
