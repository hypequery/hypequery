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
const PLACEHOLDER_PATTERN = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^{}]+\}/g;

/** Native JSON scalars that are valid parameter values without an RFC 0001 tag. */
function isNativeScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** Extract the set of parameter names a SQL text references via `{name:Type}`. */
export function extractReferencedParameters(sql: string): Set<string> {
  const names = new Set<string>();
  for (const match of sql.matchAll(PLACEHOLDER_PATTERN)) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Validate that the SQL only references declared parameters. Fails closed when a
 * placeholder names an undeclared parameter (RFC 0010 §Parameters).
 */
export function validateParameterReferences(
  sql: string,
  declarations: readonly CompiledParameterDeclaration[]
): void {
  const declared = new Set(declarations.map((d) => d.name as string));
  for (const name of extractReferencedParameters(sql)) {
    if (!declared.has(name)) {
      throw new CompiledQueryError(
        'input-invalid',
        `SQL references undeclared parameter ${name}.`
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
  if (isNativeScalar(value)) {
    return value;
  }
  // Tagged values must satisfy the RFC 0001 canonical contract, bounded by the declared
  // ClickHouse type so schema-dependent checks apply.
  try {
    validateCanonicalValue(value, {
      declaredClickHouseType: declaration.type.clickHouseType,
    });
    return value;
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
  if (sql.includes('?')) {
    throw new CompiledQueryError(
      'input-invalid',
      'Compiled SQL must not use positional placeholders.'
    );
  }
  const referenced = extractReferencedParameters(sql);
  for (const name of Object.keys(bindings)) {
    if (!referenced.has(name)) {
      throw new CompiledQueryError(
        'input-invalid',
        `Bound parameter ${name} is not referenced by the SQL.`
      );
    }
  }
}
