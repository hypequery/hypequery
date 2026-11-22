/**
 * The RFC 0028 checker for a SQL-sourced dataset: a lexical pass with
 * ClickHouse's literal rules, not a parser. Each rule refuses a construct the
 * lexer can see, so nothing is ever accepted on a judgement that it looks
 * harmless. Code-first datasets and contract validation share it.
 */

/** Why a SQL source was refused. Stable: datasets maps each to a message. */
export type ProtocolSqlSourceRefusal =
  | 'empty'
  | 'too-large'
  | 'invalid-character'
  | 'unterminated-literal'
  | 'multiple-statements'
  | 'comment'
  | 'placeholder'
  | 'not-select'
  | 'forbidden-clause'
  | 'table-function'
  | 'forbidden-function'
  | 'system-table'
  | 'unbalanced-parentheses'
  | 'unsupported-from'
  | 'undeclared-dependency'
  | 'unused-dependency';

export type ProtocolSqlSourceAnalysis =
  | {
    readonly ok: true;
    /** Tables the SQL reads, unquoted and as written, in first-reference order. */
    readonly tables: readonly string[];
    /** The SQL reads at least one table with FINAL (RFC 0021 pinning applies). */
    readonly readsFinal: boolean;
  }
  | {
    readonly ok: false;
    readonly reason: ProtocolSqlSourceRefusal;
    /** The word, function or table the refusal is about, when there is one. */
    readonly detail?: string;
  };

/** 16 KiB of UTF-8. */
export const PROTOCOL_SQL_SOURCE_MAX_BYTES = 16_384;
export const PROTOCOL_SQL_SOURCE_MAX_DEPENDENCIES = 64;

const FORBIDDEN_WORDS = new Set(['SETTINGS', 'FORMAT', 'INTO', 'OUTFILE']);
/** Functions that read an object named in a string, the filesystem, or block. */
const FORBIDDEN_FUNCTIONS = new Set([
  'joinget', 'joingetornull', 'file', 'getsetting', 'getsettingordefault', 'getserversetting', 'getmacro',
  'hascolumnintable', 'catboostevaluate', 'sleep', 'sleepeachrow',
]);
/** Statements other than SELECT. `DESC` is also a sort direction, so only a frame may not start with it. */
const STATEMENT_WORDS = new Set(['EXPLAIN', 'DESCRIBE', 'DESC', 'SHOW']);
/** Functions whose own syntax has FROM in their arguments. */
const FROM_SYNTAX_FUNCTIONS = new Set(['EXTRACT', 'SUBSTRING', 'SUBSTR', 'TRIM', 'OVERLAY']);
/** After these, a comma at the same level starts another table reference. */
const TABLE_LIST_CLAUSES = new Set(['FROM', 'JOIN', 'SAMPLE', 'ON', 'USING']);
const SYSTEM_DATABASES = new Set(['system', 'information_schema']);
/** Words that start a clause of a SELECT; a FROM-list comma only counts inside FROM. */
const CLAUSE_WORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'PREWHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT',
  'INTERSECT', 'WINDOW', 'QUALIFY', 'JOIN', 'ON', 'USING', 'WITH', 'SAMPLE', 'ARRAY',
]);

type Token =
  | { readonly kind: 'word'; readonly text: string; readonly upper: string }
  | { readonly kind: 'quoted'; readonly text: string }
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'punct'; readonly text: string };

type Refusal = { readonly ok: false; readonly reason: ProtocolSqlSourceRefusal; readonly detail?: string };

const refuse = (reason: ProtocolSqlSourceRefusal, detail?: string): Refusal => (
  Object.freeze(detail === undefined ? { ok: false, reason } : { ok: false, reason, detail })
);

const isWordStart = (char: string) => /[A-Za-z_]/.test(char);
const isWordPart = (char: string) => /[A-Za-z0-9_]/.test(char);

function isForbiddenFunction(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('dict') || FORBIDDEN_FUNCTIONS.has(lower);
}

/** Reads a quoted span starting at `start`; returns the index after it, or -1 if unterminated. */
function readQuoted(sql: string, start: number, quote: string): { end: number; text: string } | undefined {
  let text = '';
  for (let index = start + 1; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (char === '\\') {
      if (index + 1 >= sql.length) return undefined;
      text += sql[index + 1];
      index += 1;
      continue;
    }
    if (char === quote) {
      if (sql[index + 1] === quote) {
        text += quote;
        index += 1;
        continue;
      }
      return { end: index + 1, text };
    }
    text += char;
  }
  return undefined;
}

function tokenize(sql: string): Token[] | Refusal {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\'' || char === '`' || char === '"') {
      const quoted = readQuoted(sql, index, char);
      if (!quoted) return refuse('unterminated-literal');
      tokens.push(char === '\'' ? { kind: 'string' } : { kind: 'quoted', text: quoted.text });
      index = quoted.end;
      continue;
    }
    if ((char === '-' && sql[index + 1] === '-') || (char === '/' && sql[index + 1] === '*') || char === '#') {
      return refuse('comment');
    }
    if (char === ';') return refuse('multiple-statements');
    if (char === '{' || char === '}' || char === '$') return refuse('placeholder', char);
    if (isWordStart(char)) {
      let end = index + 1;
      while (end < sql.length && isWordPart(sql[end]!)) end += 1;
      const text = sql.slice(index, end);
      tokens.push({ kind: 'word', text, upper: text.toUpperCase() });
      index = end;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[0-9A-Za-z_.]/.test(sql[end]!)) end += 1;
      tokens.push({ kind: 'number' });
      index = end;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) return refuse('invalid-character');
    tokens.push({ kind: 'punct', text: char });
    index += 1;
  }
  return tokens;
}

interface Frame {
  /**
   * The arguments of a function whose syntax uses FROM (`EXTRACT(… FROM …)`).
   * Everywhere else FROM starts a table reference, including ClickHouse's
   * FROM-first `(FROM t SELECT …)`.
   */
  fromCall: boolean;
  clause: string | undefined;
  ctes: Set<string>;
  /** The CTE whose body this frame is; it becomes visible only once the body closes. */
  defines?: string;
}

const isPunct = (token: Token | undefined, text: string) => token?.kind === 'punct' && token.text === text;
const isName = (token: Token | undefined): token is Extract<Token, { kind: 'word' | 'quoted' }> => (
  token?.kind === 'word' || token?.kind === 'quoted'
);
const isWord = (token: Token | undefined, upper: string) => token?.kind === 'word' && token.upper === upper;

/**
 * Check one SQL source against RFC 0028's rules and its declared
 * dependencies. Never throws.
 */
export function analyzeProtocolSqlSource(
  sql: string,
  dependencies: readonly string[],
): ProtocolSqlSourceAnalysis {
  if (sql.trim().length === 0) return refuse('empty');
  if (sql.length > PROTOCOL_SQL_SOURCE_MAX_BYTES
    || new TextEncoder().encode(sql).byteLength > PROTOCOL_SQL_SOURCE_MAX_BYTES) {
    return refuse('too-large');
  }
  for (const character of sql) {
    const code = character.codePointAt(0)!;
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return refuse('invalid-character');
    }
  }
  // The TypeScript client substitutes `?` across the whole statement, literals included.
  if (sql.includes('?')) return refuse('placeholder', '?');
  const lexed = tokenize(sql);
  if (!Array.isArray(lexed)) return lexed;
  const tokens = lexed;
  if (!isWord(tokens[0], 'SELECT') && !isWord(tokens[0], 'WITH')) return refuse('not-select');

  const frames: Frame[] = [{ fromCall: false, clause: undefined, ctes: new Set() }];
  const tables: string[] = [];
  let readsFinal = false;
  let pendingCte: { name: string; at: number } | undefined;
  const resolvesToCte = (name: string) => frames.some(frame => frame.ctes.has(name));

  /** Reads a table reference at `index`; returns the index after it, or a refusal. */
  const readTable = (index: number): number | Refusal => {
    const first = tokens[index];
    if (isPunct(first, '(')) {
      // A parenthesized table position holds a query, never a join tree or a statement.
      const inner = tokens[index + 1];
      return isWord(inner, 'SELECT') || isWord(inner, 'WITH') || isWord(inner, 'FROM') || isPunct(inner, '(')
        ? index
        : refuse('unsupported-from');
    }
    if (!isName(first)) return refuse('unsupported-from');
    let name = first.text;
    let qualified = false;
    let next = index + 1;
    if (isPunct(tokens[next], '.')) {
      const second = tokens[next + 1];
      if (!isName(second)) return refuse('unsupported-from');
      name = `${name}.${second.text}`;
      qualified = true;
      next += 2;
    }
    if (isPunct(tokens[next], '.')) return refuse('unsupported-from');
    if (isPunct(tokens[next], '(')) return refuse('table-function', name);
    if (qualified && SYSTEM_DATABASES.has(name.slice(0, name.indexOf('.')).toLowerCase())) {
      return refuse('system-table', name);
    }
    if (!(!qualified && resolvesToCte(name)) && !tables.includes(name)) tables.push(name);
    return next;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const frame = frames[frames.length - 1]!;
    if (token.kind === 'punct') {
      if (token.text === '(') {
        const inner = tokens[index + 1];
        if (inner?.kind === 'word' && STATEMENT_WORDS.has(inner.upper)) return refuse('not-select', inner.upper);
        const previous = tokens[index - 1];
        frames.push({
          fromCall: previous?.kind === 'word' && FROM_SYNTAX_FUNCTIONS.has(previous.upper),
          clause: undefined,
          ctes: new Set(),
          ...(pendingCte?.at === index ? { defines: pendingCte.name } : {}),
        });
      } else if (token.text === ')') {
        if (frames.length === 1) return refuse('unbalanced-parentheses');
        const closed = frames.pop()!;
        // ClickHouse hides a CTE from its own body, where the name reads the physical table.
        if (closed.defines !== undefined) frames[frames.length - 1]!.ctes.add(closed.defines);
      } else if (token.text === ',' && frame.clause !== undefined && TABLE_LIST_CLAUSES.has(frame.clause)) {
        const after = readTable(index + 1);
        if (typeof after !== 'number') return after;
        index = after - 1;
      }
      continue;
    }
    if (!isName(token)) continue;
    if (isPunct(tokens[index + 1], '(') && isForbiddenFunction(token.text)) {
      return refuse('forbidden-function', token.text);
    }
    // `name AS (…)` inside WITH defines a CTE, quoted or not; see `defines`.
    if (!frame.fromCall && frame.clause === 'WITH' && isWord(tokens[index + 1], 'AS') && isPunct(tokens[index + 2], '(')) {
      pendingCte = { name: token.text, at: index + 2 };
      continue;
    }
    if (token.kind !== 'word') continue;
    const upper = token.upper;
    if (FORBIDDEN_WORDS.has(upper) || (STATEMENT_WORDS.has(upper) && upper !== 'DESC')) return refuse('forbidden-clause', upper);
    if (upper === 'FINAL') readsFinal = true;
    // `x IN t` reads a table wherever it appears, function arguments included.
    if (upper === 'IN' && isName(tokens[index + 1])) {
      const after = readTable(index + 1);
      if (typeof after !== 'number') return after;
      index = after - 1;
      continue;
    }
    if (upper === 'JOIN' && isWord(tokens[index - 1], 'ARRAY')) {
      frame.clause = 'ARRAY';
      continue;
    }
    // FROM inside a function call (EXTRACT, SUBSTRING, TRIM) is not a table position.
    if (upper === 'JOIN' || (upper === 'FROM' && !frame.fromCall)) {
      frame.clause = upper;
      const after = readTable(index + 1);
      if (typeof after !== 'number') return after;
      index = after - 1;
      continue;
    }
    if (frame.fromCall) continue;
    if (CLAUSE_WORDS.has(upper)) frame.clause = upper;
  }
  if (frames.length !== 1) return refuse('unbalanced-parentheses');

  for (const table of tables) {
    if (!dependencies.includes(table)) return refuse('undeclared-dependency', table);
  }
  for (const dependency of dependencies) {
    if (SYSTEM_DATABASES.has(dependency.split('.')[0]!.toLowerCase())) return refuse('system-table', dependency);
    if (!tables.includes(dependency)) return refuse('unused-dependency', dependency);
  }
  return Object.freeze({ ok: true, tables: Object.freeze(tables), readsFinal });
}
