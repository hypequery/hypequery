import { escapeValue } from '../utils.js';
import { skipNonCode } from './sql-parens.js';
import { serializeCompoundParameter } from './compound-parameter.js';

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

export interface NamedParameterBinding {
  /**
   * The SQL with every named placeholder rewritten to a positional `?`, kept
   * inside a `CAST` to the type the placeholder declared.
   */
  sql: string;
  /** The values behind those placeholders, in the order they appear. */
  parameters: unknown[];
}

interface PlaceholderMatch {
  name: string;
  /** The declared ClickHouse type, verbatim. */
  type: string;
  /** Index just past the closing brace. */
  end: number;
}

function readIdentifier(sql: string, start: number): string | undefined {
  if (!IDENTIFIER_START.test(sql[start] ?? '')) return undefined;
  let i = start + 1;
  while (i < sql.length && IDENTIFIER_CHAR.test(sql[i]!)) i += 1;
  return sql.slice(start, i);
}

/**
 * Reads a `{name:Type}` placeholder starting at the `{`. The type is consumed
 * with paren nesting so `{ids:Array(UInt64)}` matches, and anything that is not
 * shaped like a placeholder — a `{shard}` macro, a brace in an expression —
 * returns undefined so it is left untouched.
 */
function matchPlaceholder(sql: string, start: number): PlaceholderMatch | undefined {
  const name = readIdentifier(sql, start + 1);
  if (name === undefined) return undefined;

  let i = start + 1 + name.length;
  if (sql[i] !== ':') return undefined;
  i += 1;

  const typeStart = i;
  let depth = 0;
  while (i < sql.length) {
    const skippedTo = skipNonCode(sql, i);
    if (skippedTo !== undefined) {
      i = skippedTo;
      continue;
    }
    const ch = sql[i]!;
    if (ch === '{') return undefined;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '}' && depth === 0) {
      const type = sql.slice(typeStart, i).trim();
      return type ? { name, type, end: i + 1 } : undefined;
    }
    i += 1;
  }
  return undefined;
}

/**
 * Rewrites ClickHouse-style `{name:Type}` placeholders to the positional `?`
 * markers the builder binds against, pairing each with its value.
 *
 * TODO: Remove this client-side rewrite and its CAST/compound serialization
 * once native server-side query_params binding replaces positional parameters.
 * The public {name:Type} placeholder API can stay unchanged.
 *
 * Each marker is wrapped in a `CAST` to the declared type, which is what the
 * server's own `{name:Type}` substitution does. Without it the value arrives as
 * a String and any expression that depends on the real type fails to compile.
 *
 * Placeholders inside string literals, quoted identifiers, heredocs, and
 * comments are data and are left alone, so a body can talk about braces without
 * having them bound.
 *
 * Values that no placeholder references are ignored: a caller may pass one
 * context object to several fragments.
 */
export function bindNamedParameters(
  sql: string,
  values: Record<string, unknown> = {},
  context = 'SQL',
): NamedParameterBinding {
  const parameters: unknown[] = [];
  let bound = '';
  let copiedTo = 0;
  let i = 0;

  while (i < sql.length) {
    const skippedTo = skipNonCode(sql, i);
    if (skippedTo !== undefined) {
      i = skippedTo;
      continue;
    }

    if (sql[i] !== '{') {
      i += 1;
      continue;
    }

    const placeholder = matchPlaceholder(sql, i);
    if (!placeholder) {
      const name = readIdentifier(sql, i + 1);
      const afterName = name === undefined ? undefined : sql[i + 1 + name.length];
      if (name !== undefined && (afterName === '}' || afterName === ':') && name in values) {
        throw new Error(
          `${context} placeholder "{${name}}" is missing a type. Write it as {${name}:Type}, for example {${name}:UUID}.`
        );
      }
      i += 1;
      continue;
    }

    if (!(placeholder.name in values)) {
      throw new Error(
        `${context} references parameter "${placeholder.name}", but no value was provided for it.`
      );
    }

    // The declared type has to survive substitution: a bare escaped literal
    // reaches the server as a String, which breaks any expression that needs
    // the real type — a UUID join key, for instance.
    bound += `${sql.slice(copiedTo, i)}CAST(?, ${escapeValue(placeholder.type)})`;
    const value = values[placeholder.name];
    parameters.push(serializeCompoundParameter(value, placeholder.type));
    copiedTo = placeholder.end;
    i = placeholder.end;
  }

  return { sql: bound + sql.slice(copiedTo), parameters };
}
