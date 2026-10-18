import type { DatasetSqlBoundParameter, DatasetSqlDialectRules, DatasetSqlParameterType } from '../dataset-sql-dialect.js';

/** A compiled builder statement: SQL with positional `?` markers and their values. */
export interface BuilderStatement {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** A query builder, as far as embedding its compiled statement is concerned. */
export interface EmbeddableBuilder {
  toSQLWithParams(): BuilderStatement;
  toSQLWithPlaceholders?(placeholder: (value: unknown) => string): string;
}

/** An executable statement, rendered for its dialect. */
export interface RenderedStatement {
  sql: string;
  parameters: unknown[];
}

/**
 * Planner output that still carries markers. Not executable: only
 * {@link renderStatement} turns it into SQL, so markers cannot reach callers.
 */
export interface PlannedStatement {
  readonly text: string;
  readonly parameters: StatementParameters;
}

// Private-use code points never appear in generated SQL, and the nonce makes
// a marker unforgeable by any text that reaches a statement.
const OPEN = '\uE000';
const CLOSE = '\uE001';
const MARKER = /\uE000([0-9a-f]+):([vb]):(\d+)\uE001/g;

function createNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Owns every value bound into one statement family (a statement and its
 * preflight statements). Values are bound behind opaque markers; the dialect
 * spells placeholders once, at render time, in the order the markers appear
 * in the final text. See specs/datasets/0001-statement-parameters.md.
 */
export class StatementParameters {
  private readonly nonce = createNonce();
  private readonly values: DatasetSqlBoundParameter[] = [];
  private readonly pieces: BuilderStatement[] = [];

  constructor(readonly dialect: DatasetSqlDialectRules) {}

  /** Bind one value; place the returned marker where the value belongs. */
  bind(value: unknown, type?: DatasetSqlParameterType): string {
    this.values.push(type === undefined ? { value } : { value, type });
    return this.marker('v', this.values.length - 1);
  }

  /** Embed a builder statement whose SQL carries its own positional `?` markers. */
  embed(piece: BuilderStatement): string {
    if (!this.dialect.embedsPositionalPieces) {
      throw new Error(
        `The "${this.dialect.name}" datasets dialect cannot embed positional query builder SQL; `
        + 'the query builder must render placeholders for the datasets planner.',
      );
    }
    if (piece.sql.includes(OPEN) || piece.sql.includes(CLOSE)) {
      throw new Error('Query builder SQL cannot contain datasets statement markers.');
    }
    this.pieces.push({ sql: piece.sql, parameters: [...piece.parameters] });
    return this.marker('b', this.pieces.length - 1);
  }

  /**
   * Embed a query builder's statement.
   *
   * On positional `?` dialects the builder's own statement is embedded as one
   * block, exactly as before: `toSQLWithPlaceholders` is not called, so a
   * duck-typed builder that answers any method name keeps working. Dialects
   * that number placeholders need each value bound here, so they require the
   * builder to render through `toSQLWithPlaceholders`.
   */
  embedBuilder(builder: EmbeddableBuilder): string {
    if (this.dialect.embedsPositionalPieces) return this.embed(builder.toSQLWithParams());
    if (typeof builder.toSQLWithPlaceholders !== 'function') {
      throw new Error(
        `The "${this.dialect.name}" datasets dialect numbers placeholders; `
        + 'the query builder must implement toSQLWithPlaceholders.',
      );
    }
    const sql: unknown = builder.toSQLWithPlaceholders(value => this.bind(value));
    if (typeof sql !== 'string') throw new Error('Query builder toSQLWithPlaceholders must return SQL text.');
    return sql;
  }

  /** Replace every marker in text order. Fails closed on foreign or malformed markers. */
  render(text: string): RenderedStatement {
    const parameters: unknown[] = [];
    const reused = new Map<number, string>();
    const sql = text.replace(MARKER, (_match, nonce: string, kind: string, position: string) => {
      if (nonce !== this.nonce) throw new Error('Statement contains a marker from another compilation.');
      const index = Number(position);
      if (kind === 'b') {
        const piece = this.pieces[index];
        if (!piece) throw new Error('Statement contains an unknown builder marker.');
        parameters.push(...piece.parameters);
        return piece.sql;
      }
      const bound = this.values[index];
      if (!bound) throw new Error('Statement contains an unknown parameter marker.');
      const existing = this.dialect.reusesPlaceholders ? reused.get(index) : undefined;
      if (existing !== undefined) return existing;
      const placeholder = this.dialect.placeholder(parameters.length, bound);
      parameters.push(bound.value);
      reused.set(index, placeholder);
      return placeholder;
    });
    if (sql.includes(OPEN) || sql.includes(CLOSE)) {
      throw new Error('Statement contains a malformed parameter marker.');
    }
    return { sql, parameters };
  }

  private marker(kind: 'v' | 'b', index: number): string {
    return `${OPEN}${this.nonce}:${kind}:${index}${CLOSE}`;
  }
}

/** Render planner output for execution. The only exit from a {@link PlannedStatement}. */
export function renderStatement(statement: PlannedStatement): RenderedStatement {
  return statement.parameters.render(statement.text);
}
