/**
 * Ends a statement with `FORMAT <format>`, so the format is part of the query
 * rather than a setting a `readonly = 1` user may not change.
 *
 * Trailing semicolons, whitespace and comments are dropped first, because a
 * clause appended after them would open a second statement or be commented
 * out. Strings, quoted identifiers, heredocs and nested block comments are
 * skipped as ClickHouse's lexer does, so markers inside them are not mistaken
 * for the end of the statement.
 *
 * A statement that already ends in `FORMAT <format>` is returned trimmed; one
 * that ends in another format is refused, since its bytes would not be what the
 * caller asked for.
 */
export function withFormatClause(sql: string, format: string): string {
  const { end, trailingFormat } = scanStatementEnd(sql);
  const statement = sql.slice(0, end);

  if (trailingFormat !== undefined) {
    if (trailingFormat.toLowerCase() === format.toLowerCase()) return statement;
    throw new Error(
      `The statement ends in FORMAT ${trailingFormat}, but this call returns ${format}. ` +
      'Leave out the FORMAT clause; the adapter requests the format itself.',
    );
  }
  return `${statement}\nFORMAT ${format}`;
}

interface Token {
  kind: 'word' | 'quoted-identifier' | 'other';
  text: string;
}

interface StatementEnd {
  /** Index just past the statement's last token that is not a comment, whitespace or `;`. */
  end: number;
  /** The format named by a trailing `FORMAT <name>`, if the statement ends in one. */
  trailingFormat?: string;
}

function scanStatementEnd(sql: string): StatementEnd {
  let end = 0;
  let last: Token | undefined;
  let beforeLast: Token | undefined;
  const significant = (token: Token, tokenEnd: number) => {
    beforeLast = last;
    last = token;
    end = tokenEnd;
  };

  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (/\s/.test(char) || char === ';') {
      i++;
    } else if ((char === '-' && next === '-') || (char === '#' && (next === ' ' || next === '!'))) {
      const newline = sql.indexOf('\n', i);
      i = newline < 0 ? sql.length : newline + 1;
    } else if (char === '/' && next === '*') {
      const close = blockCommentEnd(sql, i);
      // An unclosed comment is left for ClickHouse to report.
      if (close < 0) {
        significant({ kind: 'other', text: sql.slice(i) }, sql.length);
        i = sql.length;
      } else {
        i = close;
      }
    } else if (char === "'" || char === '"' || char === '`') {
      const close = quotedEnd(sql, i);
      const text = sql.slice(i + 1, close - 1);
      significant({ kind: char === "'" ? 'other' : 'quoted-identifier', text }, close);
      i = close;
    } else if (char === '$' && heredocEnd(sql, i) > 0) {
      const close = heredocEnd(sql, i);
      significant({ kind: 'other', text: sql.slice(i, close) }, close);
      i = close;
    } else if (isWordChar(char)) {
      let close = i + 1;
      while (close < sql.length && isWordChar(sql[close]!)) close++;
      significant({ kind: 'word', text: sql.slice(i, close) }, close);
      i = close;
    } else {
      significant({ kind: 'other', text: char }, i + 1);
      i++;
    }
  }

  const endsInFormat = beforeLast?.kind === 'word'
    && beforeLast.text.toUpperCase() === 'FORMAT'
    && (last?.kind === 'word' || last?.kind === 'quoted-identifier');
  return { end, trailingFormat: endsInFormat ? last!.text : undefined };
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 0x7f;
}

/** Index past a nested block comment opened at `start`, or -1 when it is not closed. */
function blockCommentEnd(sql: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i + 1 < sql.length) {
    if (sql[i] === '/' && sql[i + 1] === '*') {
      depth++;
      i += 2;
    } else if (sql[i] === '*' && sql[i + 1] === '/') {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return -1;
}

/** Index past a quoted string or identifier opened at `start`; the end of `sql` when unclosed. */
function quotedEnd(sql: string, start: number): number {
  const quote = sql[start];
  let i = start + 1;
  while (i < sql.length) {
    const char = sql[i];
    if (char === '\\') {
      i += 2;
    } else if (char === quote) {
      // A doubled quote is an escaped quote, not the end.
      if (sql[i + 1] === quote) {
        i += 2;
      } else {
        return i + 1;
      }
    } else {
      i++;
    }
  }
  return sql.length;
}

/** Index past a `$tag$…$tag$` heredoc opened at `start`, or -1 when there is none. */
function heredocEnd(sql: string, start: number): number {
  const match = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(start));
  if (!match) return -1;
  const delimiter = match[0];
  const close = sql.indexOf(delimiter, start + delimiter.length);
  return close < 0 ? -1 : close + delimiter.length;
}
