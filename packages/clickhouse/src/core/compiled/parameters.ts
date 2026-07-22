import {
  ProtocolValueError,
  isProtocolIdentifier,
  validateCanonicalValue,
} from '@hypequery/protocol';
import { CompiledQueryError } from './errors.js';
import type {
  CompiledParameterBindings,
  CompiledParameterDeclaration,
  CompiledParameterValue,
} from './types.js';

/**
 * Matches ClickHouse native server-parameter placeholders: `{name:Type}`. This is the
 * ONLY way a value reaches a query — the name references a declared parameter and the
 * value is bound out-of-band, never rendered into the SQL text.
 */
interface SqlParameterReference {
  readonly name: string;
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

interface SqlParameterScan {
  readonly references: readonly SqlParameterReference[];
  readonly hasPositionalPlaceholder: boolean;
}

const LOGICAL_TYPES = new Set([
  'array', 'boolean', 'bytes', 'date', 'datetime', 'decimal', 'enum', 'float',
  'integer', 'map', 'null', 'string', 'tuple', 'uuid',
]);

function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === '\\') {
      index += 2;
      continue;
    }
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length;
}

function parsePlaceholder(sql: string, start: number): SqlParameterReference | undefined {
  let index = start + 1;
  while (/\s/.test(sql[index] ?? '')) index += 1;
  const nameStart = index;
  if (!/[A-Za-z_]/.test(sql[index] ?? '')) return undefined;
  index += 1;
  while (/[A-Za-z0-9_]/.test(sql[index] ?? '')) index += 1;
  const name = sql.slice(nameStart, index);
  while (/\s/.test(sql[index] ?? '')) index += 1;
  if (sql[index] !== ':') return undefined;
  index += 1;
  const typeStart = index;
  let quote: string | undefined;
  let parenthesisDepth = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (quote) {
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        quote = undefined;
      }
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      index += 1;
      continue;
    }
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') {
      parenthesisDepth -= 1;
      if (parenthesisDepth < 0) return undefined;
    }
    if (character === '{') return undefined;
    if (character === '}' && parenthesisDepth === 0) {
      const type = sql.slice(typeStart, index).trim();
      if (type.length === 0) return undefined;
      return { name, type, start, end: index + 1 };
    }
    index += 1;
  }
  return undefined;
}

function scanSqlParameters(sql: string): SqlParameterScan {
  const references: SqlParameterReference[] = [];
  let hasPositionalPlaceholder = false;
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuoted(sql, index, character);
      continue;
    }
    if (character === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === '#') {
      const newline = sql.indexOf('\n', index + 1);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === '/' && sql[index + 1] === '*') {
      const close = sql.indexOf('*/', index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (character === '?') hasPositionalPlaceholder = true;
    if (character === '{') {
      const reference = parsePlaceholder(sql, index);
      if (reference) {
        references.push(reference);
        index = reference.end;
        continue;
      }
    }
    index += 1;
  }
  return { references, hasPositionalPlaceholder };
}

/** Extract the set of parameter names a SQL text references via `{name:Type}`. */
export function extractReferencedParameters(sql: string): Set<string> {
  return new Set(scanSqlParameters(sql).references.map(({ name }) => name));
}

export function replaceParameterPlaceholders(
  sql: string,
  replace: (name: string, type: string) => string,
): string {
  const references = scanSqlParameters(sql).references;
  let result = '';
  let offset = 0;
  for (const reference of references) {
    result += sql.slice(offset, reference.start);
    result += replace(reference.name, reference.type);
    offset = reference.end;
  }
  return result + sql.slice(offset);
}

/**
 * Validate that the SQL only references declared parameters. Fails closed when a
 * placeholder names an undeclared parameter (RFC 0010 §Parameters).
 */
export function validateParameterReferences(
  sql: string,
  declarations: readonly CompiledParameterDeclaration[]
): void {
  const declared = new Map(declarations.map((declaration) => [
    declaration.name as string,
    declaration,
  ]));
  for (const reference of scanSqlParameters(sql).references) {
    const declaration = declared.get(reference.name);
    if (!declaration) {
      throw new CompiledQueryError(
        'input-invalid',
        `SQL references undeclared parameter ${reference.name}.`
      );
    }
    if (reference.type !== declaration.type.clickHouseType) {
      throw new CompiledQueryError(
        'input-invalid',
        `SQL parameter ${reference.name} does not match its declared ClickHouse type.`,
      );
    }
  }
}

/**
 * Resolve supplied values against declarations into the native `{name: value}` bindings
 * an adapter binds to server parameters. Fail-closed rules (RFC 0010 §Parameters):
 *   - a supplied name that is not declared is rejected;
 *   - a required declared name with no supplied value is rejected;
 *   - an optional declared name may be absent;
 *   - every supplied value is validated (RFC 0001 for tagged values).
 *
 * No value is ever concatenated into SQL text: values live only in the returned bindings.
 */
export function buildParameterBindings(
  declarations: readonly CompiledParameterDeclaration[],
  values: Readonly<Record<string, CompiledParameterValue>>
): CompiledParameterBindings {
  const declaredByName = new Map<string, CompiledParameterDeclaration>();
  for (const declaration of declarations) {
    if (!isProtocolIdentifier(declaration.name)) {
      throw new CompiledQueryError(
        'input-invalid',
        'Parameter declaration has an invalid name.'
      );
    }
    if (declaredByName.has(declaration.name)) {
      throw new CompiledQueryError(
        'input-invalid',
        `Duplicate parameter declaration ${declaration.name}.`
      );
    }
    declaredByName.set(declaration.name, declaration);
  }

  for (const suppliedName of Object.keys(values)) {
    if (!declaredByName.has(suppliedName)) {
      throw new CompiledQueryError(
        'input-invalid',
        `Value supplied for undeclared parameter ${suppliedName}.`
      );
    }
  }

  const bindings: Record<string, CompiledParameterValue> = {};
  for (const [name, declaration] of declaredByName) {
    const present = Object.prototype.hasOwnProperty.call(values, name);
    if (!present) {
      if (declaration.optional) continue;
      throw new CompiledQueryError(
        'input-invalid',
        `Required parameter ${name} is missing.`
      );
    }
    bindings[name] = validateParameterValue(name, declaration, values[name]);
  }

  return Object.freeze(bindings);
}

function validateParameterValue(
  name: string,
  declaration: CompiledParameterDeclaration,
  value: CompiledParameterValue
): CompiledParameterValue {
  try {
    const validated = validateCanonicalValue(value, {
      declaredClickHouseType: declaration.type.clickHouseType,
    });
    validateLogicalType(name, declaration, validated);
    return validated as CompiledParameterValue;
  } catch (error) {
    if (error instanceof ProtocolValueError) {
      throw new CompiledQueryError(
        'input-invalid',
        `Parameter ${name} failed value validation (${error.code}).`,
        { cause: error }
      );
    }
    throw error;
  }
}

function logicalTypeOf(value: CompiledParameterValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'boolean') return 'boolean';
  return value.$hypequery.type;
}

function unwrapNullable(type: string): { readonly nullable: boolean; readonly inner: string } {
  const trimmed = type.trim();
  if (trimmed.startsWith('Nullable(') && trimmed.endsWith(')')) {
    return { nullable: true, inner: trimmed.slice(9, -1).trim() };
  }
  return { nullable: false, inner: trimmed };
}

function clickHouseTypeSupportsLogical(type: string, logical: string): boolean {
  const { nullable, inner } = unwrapNullable(type);
  if (logical === 'null') return nullable;
  switch (logical) {
    case 'string': return /^(?:String|FixedString\(\d+\)|LowCardinality\(String\))$/.test(inner);
    case 'float': return /^Float(?:32|64)$/.test(inner);
    case 'boolean': return /^(?:Bool|Boolean)$/.test(inner);
    case 'integer': return /^(?:U?Int)(?:8|16|32|64|128|256)$/.test(inner);
    case 'decimal': return /^Decimal(?:(?:32|64|128|256)\(\d+\)|\(\d+\s*,\s*\d+\))$/.test(inner);
    case 'date': return /^(?:Date|Date32)$/.test(inner);
    case 'datetime': return /^DateTime(?:64)?(?:\(.*\))?$/.test(inner);
    case 'uuid': return inner === 'UUID';
    case 'bytes': return /^(?:String|FixedString\(\d+\))$/.test(inner);
    case 'enum': return /^Enum(?:8|16)\(.*\)$/.test(inner);
    case 'array': return /^Array\(.+\)$/.test(inner);
    case 'tuple': return /^Tuple\(.+\)$/.test(inner);
    case 'map': return /^Map\(.+\)$/.test(inner);
    default: return false;
  }
}

function validateLogicalType(
  name: string,
  declaration: CompiledParameterDeclaration,
  value: CompiledParameterValue,
): void {
  const actual = logicalTypeOf(value);
  const declared = declaration.type.logical;
  if (!LOGICAL_TYPES.has(declared) || (actual !== declared && actual !== 'null')) {
    throw new CompiledQueryError(
      'input-invalid',
      `Parameter ${name} does not match its declared logical type.`,
    );
  }
  if (!clickHouseTypeSupportsLogical(declaration.type.clickHouseType, actual)) {
    throw new CompiledQueryError(
      'input-invalid',
      `Parameter ${name} does not match its declared ClickHouse type.`,
    );
  }
}

/**
 * Assert the invariant that no bound value has leaked into the SQL text. The compile path
 * never substitutes values, so this is a defense-in-depth check: the SQL must reference
 * every non-optional bound name through a placeholder and must not be the legacy
 * positional form (`?`).
 */
export function assertNoValuesInSql(
  sql: string,
  bindings: CompiledParameterBindings
): void {
  const scan = scanSqlParameters(sql);
  if (scan.hasPositionalPlaceholder) {
    throw new CompiledQueryError(
      'input-invalid',
      'Compiled SQL must not use positional placeholders.'
    );
  }
  const referenced = new Set(scan.references.map(({ name }) => name));
  for (const name of Object.keys(bindings)) {
    if (!referenced.has(name)) {
      throw new CompiledQueryError(
        'input-invalid',
        `Bound parameter ${name} is not referenced by the SQL.`
      );
    }
  }
  for (const name of referenced) {
    if (!Object.prototype.hasOwnProperty.call(bindings, name)) {
      throw new CompiledQueryError(
        'input-invalid',
        `SQL parameter ${name} does not have a bound value.`,
      );
    }
  }
}
