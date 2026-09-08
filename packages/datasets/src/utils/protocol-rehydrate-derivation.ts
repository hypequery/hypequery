/**
 * Rebuilds a derived metric's formula from the contract's authored form.
 *
 * The formula is reconstructed by calling the same helpers in `formulas.ts`
 * that authored it, rather than by compiling the expression to SQL here. That
 * is deliberate: those helpers carry the `toSQL` closures that decide spacing,
 * parenthesisation, and function spelling, so reusing them makes byte-identity
 * structural. A second compiler would be a second place for that spelling to
 * live, and the two would drift the first time either changed.
 */

import type { ProtocolExpression, ProtocolMetricDerivation } from '@hypequery/protocol';
import {
  add,
  ceil,
  coalesce,
  divide,
  floor,
  multiply,
  nullIfZero,
  round,
  subtract,
} from '../formulas.js';
import type { FormulaExpr } from '../types.js';

/** What a formula helper accepts: an alias/column name, or a nested expression. */
type Operand = string | FormulaExpr;

/** Maps a reference in the contract to the name this build should emit. */
type ResolveName = (name: string) => string;

type Unsupported = (reason: string) => Error;

const BINARY: Record<string, (a: Operand, b: Operand) => FormulaExpr> = {
  add, subtract, multiply, divide,
};

function arity(
  args: readonly ProtocolExpression[],
  expected: number,
  name: string,
  unsupported: Unsupported,
): void {
  if (args.length !== expected) {
    throw unsupported(`"${name}" takes ${expected} argument(s), received ${args.length}`);
  }
}

function literalNumber(expression: ProtocolExpression, unsupported: Unsupported): number {
  if (expression.kind !== 'literal' || typeof expression.value !== 'number') {
    throw unsupported('expected a numeric literal argument');
  }
  return expression.value;
}

/**
 * A `coalesce` fallback, the one position that accepts a bare value.
 *
 * `formulas.ts` renders a number through `String(...)` and anything else
 * through the operand path, so both round-trip to the same SQL.
 */
function fallback(
  expression: ProtocolExpression,
  resolve: ResolveName,
  unsupported: Unsupported,
): number | Operand {
  if (expression.kind !== 'literal') return operand(expression, resolve, unsupported);
  if (typeof expression.value !== 'number') {
    throw unsupported('a "coalesce" fallback literal must be numeric');
  }
  return expression.value;
}

function operand(
  expression: ProtocolExpression,
  resolve: ResolveName,
  unsupported: Unsupported,
): Operand {
  switch (expression.kind) {
    case 'reference':
      // An alias, or a column the formula named directly. `resolveArg` in
      // `formulas.ts` passes a string through unchanged, which is what the
      // authored form did with the same name.
      return resolve(String(expression.name));
    case 'binary': {
      const build = BINARY[expression.operator];
      if (build === undefined) throw unsupported(`unsupported operator "${expression.operator}"`);
      return build(
        operand(expression.left, resolve, unsupported),
        operand(expression.right, resolve, unsupported),
      );
    }
    case 'call':
      switch (expression.function) {
        case 'nullIfZero':
          arity(expression.args, 1, 'nullIfZero', unsupported);
          return nullIfZero(operand(expression.args[0], resolve, unsupported));
        case 'floor':
          arity(expression.args, 1, 'floor', unsupported);
          return floor(operand(expression.args[0], resolve, unsupported));
        case 'ceil':
          arity(expression.args, 1, 'ceil', unsupported);
          return ceil(operand(expression.args[0], resolve, unsupported));
        case 'round':
          arity(expression.args, 2, 'round', unsupported);
          return round(
            operand(expression.args[0], resolve, unsupported),
            literalNumber(expression.args[1], unsupported),
          );
        case 'coalesce':
          arity(expression.args, 2, 'coalesce', unsupported);
          return coalesce(
            operand(expression.args[0], resolve, unsupported),
            fallback(expression.args[1], resolve, unsupported),
          );
        default:
          throw unsupported(`unsupported function "${String(expression.function)}"`);
      }
    default:
      // A literal outside a `round` precision or `coalesce` fallback, or an
      // aggregate that should have been carried as a named input. Either way
      // the authoring API cannot express it, so rebuilding would be a guess.
      throw unsupported(`a formula cannot contain a "${expression.kind}" expression here`);
  }
}

function buildFormula(
  derivation: ProtocolMetricDerivation,
  resolve: ResolveName,
  unsupported: Unsupported,
): FormulaExpr {
  const built = operand(derivation.expression, resolve, unsupported);
  if (typeof built === 'string') {
    // `spec.formula(...)` must return a `FormulaExpr`. A formula that is a bare
    // reference names one of its inputs instead of combining them, which the
    // authoring API cannot produce.
    throw unsupported('a formula must combine its inputs rather than name one');
  }
  return built;
}

/**
 * The formula function a derived metric spec expects.
 *
 * The returned function maps each declared alias through the caller-supplied
 * `inputs` record, exactly as an authored formula does — both the plan builder
 * and the query-builder path pass alias-to-alias, so the emitted column names
 * are the ones the contract declared.
 *
 * The formula is built once here as well, so a malformed one is refused when
 * the metric is rebuilt rather than on the first query that reaches it.
 */
export function rehydrateDerivedFormula(
  derivation: ProtocolMetricDerivation,
  unsupported: Unsupported,
): (inputs: Record<string, string>) => FormulaExpr {
  buildFormula(derivation, name => name, unsupported);
  return inputs => buildFormula(derivation, name => inputs[name] ?? name, unsupported);
}
