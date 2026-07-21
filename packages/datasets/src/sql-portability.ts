import {
  parseProtocolQualifiedIdentifier,
  ProtocolIdentifierError,
  validateProtocolExpression,
  type ProtocolBinaryOperator,
  type ProtocolComparisonOperator,
  type ProtocolExpression,
  type ProtocolFunctionName,
} from '@hypequery/protocol';

/**
 * SQL portability compiler (R1A-07).
 *
 * Parses the supported ClickHouse SQL-expression subset used by SQL-backed
 * dimensions and measures into an RFC 0003 expression AST. Unsupported syntax
 * becomes a source-located incompatibility issue instead of executing or
 * silently changing meaning.
 */

export type SqlPortabilityIssueCode =
  | 'HQ_SQL_PORT_SYNTAX'
  | 'HQ_SQL_PORT_UNSUPPORTED_FUNCTION'
  | 'HQ_SQL_PORT_UNSUPPORTED_OPERATOR'
  | 'HQ_SQL_PORT_UNSUPPORTED_LITERAL'
  | 'HQ_SQL_PORT_UNSUPPORTED_SYNTAX'
  | 'HQ_SQL_PORT_TOO_COMPLEX'
  | 'HQ_SQL_PORT_TOO_LARGE';

export interface SqlPortabilityIssue {
  readonly code: SqlPortabilityIssueCode;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface SqlPortabilityLimits {
  readonly maxInputBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export interface SqlPortabilityOptions {
  readonly limits?: Partial<SqlPortabilityLimits>;
}

export interface SqlPortabilitySuccess {
  readonly portable: true;
  readonly expression: ProtocolExpression;
  readonly dependencies: readonly string[];
}

export interface SqlPortabilityFailure {
  readonly portable: false;
  readonly issues: readonly SqlPortabilityIssue[];
}

export type SqlPortabilityResult = SqlPortabilitySuccess | SqlPortabilityFailure;

export const DEFAULT_SQL_PORTABILITY_LIMITS: Readonly<SqlPortabilityLimits> =
  Object.freeze({
    maxInputBytes: 65_536,
    maxDepth: 16,
    maxNodes: 1_000,
  });

function resolveSqlPortabilityLimits(
  options: SqlPortabilityOptions = {},
): Readonly<SqlPortabilityLimits> {
  const limits = { ...DEFAULT_SQL_PORTABILITY_LIMITS };
  for (const key of Object.keys(limits) as (keyof SqlPortabilityLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_SQL_PORTABILITY_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} `
        + '(the SQL portability v1 maximum)',
      );
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

class SqlPortabilityError extends Error {
  readonly issue: SqlPortabilityIssue;

  constructor(issue: SqlPortabilityIssue) {
    super(issue.message);
    this.name = 'SqlPortabilityError';
    this.issue = issue;
  }
}

function fail(
  code: SqlPortabilityIssueCode,
  message: string,
  start: number,
  end: number,
): never {
  throw new SqlPortabilityError({ code, message, start, end });
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'identifier' | 'number' | 'string' | 'operator' | 'keyword' | 'unknown';

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Keywords with direct AST support, keyed by their uppercase spelling. */
const KEYWORDS: Readonly<Record<string, string>> = Object.freeze({
  AND: 'and',
  OR: 'or',
  NOT: 'not',
  IN: 'in',
  BETWEEN: 'between',
  LIKE: 'like',
  TRUE: 'true',
  FALSE: 'false',
  NULL: 'null',
});

/** Reserved words that prove the input is not a portable expression. */
const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'ALTER', 'AS', 'CASE', 'CAST', 'CREATE', 'DATABASE', 'DELETE', 'DROP',
  'ELSE', 'END', 'EXCEPT', 'EXISTS', 'FORMAT', 'FROM', 'GROUP', 'HAVING',
  'INSERT', 'INTERSECT', 'INTO', 'JOIN', 'LAMBDA', 'LIMIT', 'ORDER', 'OVER',
  'PARTITION', 'PREWHERE', 'SELECT', 'SETTINGS', 'TABLE', 'THEN', 'TRUNCATE',
  'UNION', 'UPDATE', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
]);

const BARE_IDENTIFIER_FULL = /^[A-Za-z_][A-Za-z0-9_]*$/;

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const push = (type: TokenType, value: string, start: number, end: number): void => {
    tokens.push({ type, value, start, end });
  };
  while (index < sql.length) {
    const start = index;
    const char = sql[index]!;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if (char === '-' && sql[index + 1] === '-') {
      fail('HQ_SQL_PORT_UNSUPPORTED_SYNTAX', 'Comments are not portable.', start, start + 2);
    }
    if (char === '/' && sql[index + 1] === '*') {
      fail('HQ_SQL_PORT_UNSUPPORTED_SYNTAX', 'Comments are not portable.', start, start + 2);
    }
    if ('(),'.includes(char)) {
      push('operator', char, start, start + 1);
      index += 1;
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/') {
      push('operator', char, start, start + 1);
      index += 1;
      continue;
    }
    if (char === '=' && sql[index + 1] === '=') {
      fail(
        'HQ_SQL_PORT_UNSUPPORTED_OPERATOR',
        'Operator "==" is not portable; use "=" for equality.',
        start,
        start + 2,
      );
    }
    if (char === '=') {
      push('operator', '=', start, start + 1);
      index += 1;
      continue;
    }
    if (char === '!' && sql[index + 1] === '=') {
      push('operator', '!=', start, start + 2);
      index += 2;
      continue;
    }
    if (char === '<' && sql[index + 1] === '>') {
      push('operator', '!=', start, start + 2);
      index += 2;
      continue;
    }
    if (char === '<' && sql[index + 1] === '=') {
      push('operator', '<=', start, start + 2);
      index += 2;
      continue;
    }
    if (char === '>' && sql[index + 1] === '=') {
      push('operator', '>=', start, start + 2);
      index += 2;
      continue;
    }
    if (char === '<' || char === '>') {
      push('operator', char, start, start + 1);
      index += 1;
      continue;
    }
    if (char === '%' || char === '^' || char === '&' || char === '|'
      || char === '~' || char === ':' || char === '?' || char === '@') {
      fail('HQ_SQL_PORT_UNSUPPORTED_OPERATOR', `Operator "${char}" is not portable.`, start, start + 1);
    }
    if (char === ';' || char === '[' || char === ']' || char === '{' || char === '}'
      || char === '"' || char === '$' || char === '#') {
      fail('HQ_SQL_PORT_UNSUPPORTED_SYNTAX', `Syntax "${char}" is not portable.`, start, start + 1);
    }
    if (char === '\'') {
      index += 1;
      let value = '';
      let closed = false;
      while (index < sql.length) {
        const current = sql[index]!;
        if (current === '\'') {
          if (sql[index + 1] === '\'') {
            value += '\'';
            index += 2;
            continue;
          }
          closed = true;
          index += 1;
          break;
        }
        if (current === '\\') {
          fail(
            'HQ_SQL_PORT_UNSUPPORTED_LITERAL',
            'Backslash escapes are not portable; double the quote instead.',
            index,
            index + 1,
          );
        }
        value += current;
        index += 1;
      }
      if (!closed) fail('HQ_SQL_PORT_SYNTAX', 'Unterminated string literal.', start, sql.length);
      push('string', value, start, index);
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[index + 1] ?? ''))) {
      const match = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|^\.[0-9]+(?:[eE][+-]?[0-9]+)?/
        .exec(sql.slice(index));
      const text = match![0];
      push('number', text, start, start + text.length);
      index += text.length;
      continue;
    }
    if (char === '`' || /[A-Za-z_]/.test(char)) {
      const segments: string[] = [];
      let bareOnly = true;
      while (true) {
        if (sql[index] === '`') {
          bareOnly = false;
          index += 1;
          let segment = '';
          let closed = false;
          while (index < sql.length) {
            if (sql[index] === '`') {
              if (sql[index + 1] === '`') {
                segment += '`';
                index += 2;
                continue;
              }
              closed = true;
              index += 1;
              break;
            }
            segment += sql[index];
            index += 1;
          }
          if (!closed) {
            fail('HQ_SQL_PORT_SYNTAX', 'Unterminated quoted identifier.', start, sql.length);
          }
          if (!BARE_IDENTIFIER_FULL.test(segment)) {
            fail(
              'HQ_SQL_PORT_SYNTAX',
              `Quoted identifier "${segment}" is not portable.`,
              start,
              index,
            );
          }
          segments.push(segment);
        } else {
          const bare = BARE_IDENTIFIER.exec(sql.slice(index));
          if (!bare) break;
          segments.push(bare[0]);
          index += bare[0].length;
        }
        if (sql[index] === '.') {
          if (sql[index + 1] === '`' || /[A-Za-z_]/.test(sql[index + 1] ?? '')) {
            index += 1;
            continue;
          }
          fail('HQ_SQL_PORT_SYNTAX', 'Expected an identifier after ".".', index, index + 1);
        }
        break;
      }
      const value = segments.join('.');
      if (bareOnly && segments.length === 1) {
        const keyword = KEYWORDS[value.toUpperCase()];
        if (keyword !== undefined) {
          push('keyword', keyword, start, index);
        } else if (UNSUPPORTED_KEYWORDS.has(value.toUpperCase())) {
          fail(
            'HQ_SQL_PORT_UNSUPPORTED_SYNTAX',
            `"${value}" is not part of the portable expression subset.`,
            start,
            index,
          );
        } else {
          push('identifier', value, start, index);
        }
      } else {
        push('identifier', value, start, index);
      }
      continue;
    }
    fail('HQ_SQL_PORT_UNSUPPORTED_SYNTAX', `Unexpected character "${char}".`, start, start + 1);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const CALL_ARITY: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  nullifzero: [1, 1],
  coalesce: [2, 2],
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
});

const CALL_CANONICAL: Readonly<Record<string, ProtocolFunctionName>> = Object.freeze({
  nullifzero: 'nullIfZero',
  coalesce: 'coalesce',
  round: 'round',
  floor: 'floor',
  ceil: 'ceil',
});

const BINARY_OPERATORS: Readonly<Record<string, ProtocolBinaryOperator>> = Object.freeze({
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
});

const COMPARISON_OPERATORS: Readonly<Record<string, ProtocolComparisonOperator>> = Object.freeze({
  '=': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
});

function node(expression: ProtocolExpression): ProtocolExpression {
  return Object.freeze(expression);
}

class Parser {
  private position = 0;
  private nodes = 0;
  private readonly dependencies = new Set<string>();

  constructor(
    private readonly tokens: readonly Token[],
    private readonly limits: Readonly<SqlPortabilityLimits>,
  ) {}

  parse(): { expression: ProtocolExpression; dependencies: readonly string[] } {
    if (this.tokens.length === 0) fail('HQ_SQL_PORT_SYNTAX', 'The expression is empty.', 0, 0);
    const expression = this.parseOr(0);
    const rest = this.peek();
    if (rest) fail('HQ_SQL_PORT_SYNTAX', 'Unexpected trailing input.', rest.start, rest.end);
    return {
      expression,
      dependencies: Object.freeze([...this.dependencies].sort()),
    };
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (!token) {
      const end = this.tokens.length === 0 ? 0 : this.tokens[this.tokens.length - 1]!.end;
      fail('HQ_SQL_PORT_SYNTAX', 'Unexpected end of expression.', end, end);
    }
    this.position += 1;
    return token;
  }

  private enter(depth: number, token: Token): void {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      fail('HQ_SQL_PORT_TOO_COMPLEX', 'The expression exceeds its node limit.', token.start, token.end);
    }
    if (depth > this.limits.maxDepth) {
      fail('HQ_SQL_PORT_TOO_COMPLEX', 'The expression exceeds its depth limit.', token.start, token.end);
    }
  }

  private parseOr(depth: number): ProtocolExpression {
    const operands = [this.parseAnd(depth)];
    while (this.peek()?.type === 'keyword' && this.peek()!.value === 'or') {
      this.next();
      operands.push(this.parseAnd(depth));
    }
    if (operands.length === 1) return operands[0]!;
    this.enter(depth, this.tokens[this.position - 1]!);
    return node({ kind: 'logical', operator: 'or', operands: Object.freeze(operands) });
  }

  private parseAnd(depth: number): ProtocolExpression {
    const operands = [this.parseNot(depth)];
    while (this.peek()?.type === 'keyword' && this.peek()!.value === 'and') {
      this.next();
      operands.push(this.parseNot(depth));
    }
    if (operands.length === 1) return operands[0]!;
    this.enter(depth, this.tokens[this.position - 1]!);
    return node({ kind: 'logical', operator: 'and', operands: Object.freeze(operands) });
  }

  private parseNot(depth: number): ProtocolExpression {
    const token = this.peek();
    if (token?.type === 'keyword' && token.value === 'not') {
      this.next();
      this.enter(depth + 1, token);
      return node({
        kind: 'logical',
        operator: 'not',
        operand: this.parseNot(depth + 1),
      });
    }
    return this.parseComparison(depth);
  }

  private parseComparison(depth: number): ProtocolExpression {
    const left = this.parseAdditive(depth);
    const token = this.peek();
    if (!token) return left;

    if (token.type === 'operator' && COMPARISON_OPERATORS[token.value] !== undefined) {
      this.next();
      const operator = COMPARISON_OPERATORS[token.value]!;
      const right = this.parseAdditive(depth);
      this.enter(depth + 1, token);
      this.rejectChained();
      return node({ kind: 'comparison', operator, left, right });
    }
    if (token.type === 'keyword' && token.value === 'like') {
      this.next();
      const right = this.parseAdditive(depth);
      this.enter(depth + 1, token);
      this.rejectChained();
      return node({ kind: 'comparison', operator: 'like', left, right });
    }
    if (token.type === 'keyword' && token.value === 'between') {
      this.next();
      const lower = this.parseAdditive(depth);
      const junction = this.peek();
      if (junction?.type !== 'keyword' || junction.value !== 'and') {
        fail(
          'HQ_SQL_PORT_SYNTAX',
          'BETWEEN requires an AND separator.',
          junction?.start ?? token.end,
          junction?.end ?? token.end,
        );
      }
      this.next();
      const upper = this.parseAdditive(depth);
      this.enter(depth + 1, token);
      this.rejectChained();
      return node({
        kind: 'comparison',
        operator: 'between',
        left,
        right: this.tupleLiteral(lower, upper, token),
      });
    }
    if (token.type === 'keyword' && (token.value === 'in' || token.value === 'not')) {
      this.next();
      if (token.value === 'not') {
        const following = this.peek();
        if (following?.type === 'keyword' && following.value === 'in') {
          this.next();
          return this.parseInList(left, 'notIn', token, depth);
        }
        fail(
          'HQ_SQL_PORT_UNSUPPORTED_OPERATOR',
          'Only NOT IN is portable; NOT LIKE and NOT BETWEEN are not.',
          token.start,
          (following ?? token).end,
        );
      }
      return this.parseInList(left, 'in', token, depth);
    }
    return left;
  }

  private rejectChained(): void {
    const token = this.peek();
    if (token && (token.type === 'operator' && COMPARISON_OPERATORS[token.value] !== undefined
      || token.type === 'keyword'
        && ['like', 'between', 'in'].includes(token.value))) {
      fail(
        'HQ_SQL_PORT_SYNTAX',
        'Chained comparisons are not portable; combine them with AND/OR.',
        token.start,
        token.end,
      );
    }
  }

  private tupleLiteral(
    lower: ProtocolExpression,
    upper: ProtocolExpression,
    token: Token,
  ): ProtocolExpression {
    for (const bound of [lower, upper]) {
      if (bound.kind !== 'literal') {
        fail(
          'HQ_SQL_PORT_UNSUPPORTED_SYNTAX',
          'BETWEEN bounds must be literal values.',
          token.start,
          token.end,
        );
      }
    }
    const bounds = [lower, upper] as readonly [
      Extract<ProtocolExpression, { readonly kind: 'literal' }>,
      Extract<ProtocolExpression, { readonly kind: 'literal' }>,
    ];
    return node({
      kind: 'literal',
      value: {
        $hypequery: {
          type: 'tuple',
          version: 1,
          values: [bounds[0].value, bounds[1].value],
        },
      },
    } as ProtocolExpression);
  }

  private parseInList(
    left: ProtocolExpression,
    operator: ProtocolComparisonOperator,
    token: Token,
    depth: number,
  ): ProtocolExpression {
    const open = this.peek();
    if (open?.type !== 'operator' || open.value !== '(') {
      fail('HQ_SQL_PORT_SYNTAX', 'IN requires a parenthesized literal list.', token.start, token.end);
    }
    this.next();
    const values: unknown[] = [];
    if (this.peek()?.type === 'operator' && this.peek()!.value === ')') {
      fail('HQ_SQL_PORT_SYNTAX', 'IN requires at least one element.', open.start, open.end);
    }
    while (true) {
      const element = this.parseUnary(depth + 1);
      if (element.kind !== 'literal') {
        fail(
          'HQ_SQL_PORT_UNSUPPORTED_SYNTAX',
          'IN list elements must be literal values.',
          token.start,
          token.end,
        );
      }
      values.push(element.value);
      const separator = this.peek();
      if (separator?.type === 'operator' && separator.value === ',') {
        this.next();
        const following = this.peek();
        if (following?.type === 'operator' && following.value === ')') {
          fail(
            'HQ_SQL_PORT_SYNTAX',
            'IN lists do not allow a trailing comma.',
            separator.start,
            following.end,
          );
        }
        continue;
      }
      if (separator?.type === 'operator' && separator.value === ')') {
        this.next();
        break;
      }
      fail(
        'HQ_SQL_PORT_SYNTAX',
        'Expected "," or ")" in the IN list.',
        separator?.start ?? token.end,
        separator?.end ?? token.end,
      );
    }
    this.enter(depth + 1, token);
    this.rejectChained();
    return node({
      kind: 'comparison',
      operator,
      left,
      right: {
        kind: 'literal',
        value: {
          $hypequery: {
            type: 'array',
            version: 1,
            values,
          },
        },
      } as ProtocolExpression,
    });
  }

  private parseAdditive(depth: number): ProtocolExpression {
    let left = this.parseMultiplicative(depth);
    while (true) {
      const token = this.peek();
      if (token?.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      this.next();
      const right = this.parseMultiplicative(depth + 1);
      this.enter(depth + 1, token);
      left = node({
        kind: 'binary',
        operator: BINARY_OPERATORS[token.value]!,
        left,
        right,
      });
    }
    return left;
  }

  private parseMultiplicative(depth: number): ProtocolExpression {
    let left = this.parseUnary(depth);
    while (true) {
      const token = this.peek();
      if (token?.type !== 'operator' || (token.value !== '*' && token.value !== '/')) break;
      this.next();
      const right = this.parseUnary(depth + 1);
      this.enter(depth + 1, token);
      left = node({
        kind: 'binary',
        operator: BINARY_OPERATORS[token.value]!,
        left,
        right,
      });
    }
    return left;
  }

  private parseUnary(depth: number): ProtocolExpression {
    let token = this.peek();
    while (token?.type === 'operator' && token.value === '+') {
      this.next();
      token = this.peek();
    }
    if (token?.type === 'operator' && token.value === '-') {
      this.next();
      const operand = this.peek();
      if (operand?.type !== 'number') {
        fail(
          'HQ_SQL_PORT_UNSUPPORTED_OPERATOR',
          'Negation is only portable on numeric literals.',
          token.start,
          token.end,
        );
      }
      this.next();
      return this.numericLiteral(operand, true);
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): ProtocolExpression {
    const token = this.next();
    this.enter(depth, token);
    switch (token.type) {
      case 'number':
        return this.numericLiteral(token, false);
      case 'string':
        return node({ kind: 'literal', value: token.value });
      case 'keyword':
        if (token.value === 'true') return node({ kind: 'literal', value: true });
        if (token.value === 'false') return node({ kind: 'literal', value: false });
        if (token.value === 'null') return node({ kind: 'literal', value: null });
        break;
      case 'identifier': {
        const open = this.peek();
        if (open?.type === 'operator' && open.value === '(') {
          return this.parseCall(token, depth);
        }
        let name: ReturnType<typeof parseProtocolQualifiedIdentifier>;
        try {
          name = parseProtocolQualifiedIdentifier(token.value);
        } catch (error) {
          if (error instanceof ProtocolIdentifierError) {
            fail(
              'HQ_SQL_PORT_SYNTAX',
              `Identifier "${token.value}" is not portable.`,
              token.start,
              token.end,
            );
          }
          throw error;
        }
        this.dependencies.add(token.value);
        return node({ kind: 'reference', name });
      }
      case 'operator':
        if (token.value === '(') {
          const expression = this.parseOr(depth + 1);
          const close = this.peek();
          if (close?.type !== 'operator' || close.value !== ')') {
            fail('HQ_SQL_PORT_SYNTAX', 'Expected ")".', close?.start ?? token.end, close?.end ?? token.end);
          }
          this.next();
          return expression;
        }
        break;
    }
    fail('HQ_SQL_PORT_SYNTAX', `Unexpected "${token.value}".`, token.start, token.end);
  }

  private parseCall(name: Token, depth: number): ProtocolExpression {
    const key = name.value.toLowerCase();
    const canonical = CALL_CANONICAL[key];
    const arity = CALL_ARITY[key];
    if (canonical === undefined || arity === undefined) {
      const open = this.peek()!;
      fail(
        'HQ_SQL_PORT_UNSUPPORTED_FUNCTION',
        `Function "${name.value}" is not in the portable allowlist.`,
        name.start,
        open.end,
      );
    }
    this.next(); // consume '('
    const args: ProtocolExpression[] = [];
    if (!(this.peek()?.type === 'operator' && this.peek()!.value === ')')) {
      while (true) {
        args.push(this.parseOr(depth + 1));
        const separator = this.peek();
        if (separator?.type === 'operator' && separator.value === ',') {
          this.next();
          continue;
        }
        break;
      }
    }
    const close = this.peek();
    if (close?.type !== 'operator' || close.value !== ')') {
      fail('HQ_SQL_PORT_SYNTAX', 'Expected ")".', close?.start ?? name.end, close?.end ?? name.end);
    }
    this.next();
    if (args.length < arity[0] || args.length > arity[1]) {
      fail(
        'HQ_SQL_PORT_SYNTAX',
        `Function "${canonical}" expects ${arity[0] === arity[1] ? arity[0] : `${arity[0]} to ${arity[1]}`} arguments.`,
        name.start,
        close.end,
      );
    }
    return node({
      kind: 'call',
      function: canonical,
      args: Object.freeze(args),
    });
  }

  private numericLiteral(token: Token, negated: boolean): ProtocolExpression {
    const value = Number(token.value) * (negated ? -1 : 1);
    if (!Number.isFinite(value)
      || Object.is(value, -0)
      || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail(
        'HQ_SQL_PORT_UNSUPPORTED_LITERAL',
        `Numeric literal "${token.value}" is outside the portable range.`,
        token.start,
        token.end,
      );
    }
    return node({ kind: 'literal', value });
  }
}

const textEncoder = new TextEncoder();

/**
 * Compile a SQL expression fragment into an RFC 0003 expression. The result
 * expression always passes RFC 0003 validation; dependencies are the sorted,
 * deduplicated referenced identifiers.
 */
export function compilePortableSqlExpression(
  sql: string,
  options: SqlPortabilityOptions = {},
): SqlPortabilityResult {
  const limits = resolveSqlPortabilityLimits(options);
  try {
    if (typeof sql !== 'string' || sql.length > limits.maxInputBytes
      || textEncoder.encode(sql).byteLength > limits.maxInputBytes) {
      fail(
        'HQ_SQL_PORT_TOO_LARGE',
        'The expression exceeds its byte limit.',
        0,
        typeof sql === 'string' ? sql.length : 0,
      );
    }
    const parsed = new Parser(tokenize(sql), limits).parse();
    const expression = validateProtocolExpression(parsed.expression);
    return Object.freeze({
      portable: true,
      expression,
      dependencies: parsed.dependencies,
    });
  } catch (error) {
    if (error instanceof SqlPortabilityError) {
      return Object.freeze({ portable: false, issues: Object.freeze([error.issue]) });
    }
    throw error;
  }
}
