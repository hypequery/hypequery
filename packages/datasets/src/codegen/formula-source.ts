import type { ProtocolExpression } from '@hypequery/protocol';

import { isBindingName, literal } from './utils/source-writer.js';

/**
 * A derived measure's formula as the arrow function an author writes:
 * `({ revenue, orders }) => divide(revenue, nullIfZero(orders))`.
 *
 * It accepts exactly the grammar `protocol-rehydrate-derivation.ts` rebuilds
 * through `formulas.ts`, so the code calls the same helpers that produced the
 * contract and its SQL is byte-identical. Anything else is refused.
 */

const BINARY = new Set(['add', 'subtract', 'multiply', 'divide']);
/** Every helper a formula can call: an input destructured under one of these names would hide it. */
const HELPERS = new Set([...BINARY, 'nullIfZero', 'floor', 'ceil', 'round', 'coalesce']);

export interface FormulaSource {
  readonly code: string;
  /** Helpers from `@hypequery/datasets` the formula calls. */
  readonly helpers: ReadonlySet<string>;
}

export function formulaSource(
  expression: ProtocolExpression,
  aliases: readonly string[],
  unsupported: (reason: string) => Error,
): FormulaSource {
  const helpers = new Set<string>();
  const known = new Set(aliases);
  const referenced = new Set<string>();
  // `({ revenue, orders }) => …` where every input can be a binding that hides
  // no helper; otherwise `(inputs) => divide(inputs.divide, …)`.
  const destructure = aliases.every(alias => isBindingName(alias) && !HELPERS.has(alias));

  const reference = (name: string): string => {
    if (!known.has(name)) return literal(name);
    referenced.add(name);
    return destructure ? name : `inputs[${literal(name)}]`;
  };

  const numeric = (value: ProtocolExpression, what: string): string => {
    if (value.kind !== 'literal' || typeof value.value !== 'number') {
      throw unsupported(`${what} must be a numeric literal`);
    }
    return literal(value.value);
  };

  const arity = (args: readonly ProtocolExpression[], expected: number, name: string) => {
    if (args.length !== expected) {
      throw unsupported(`"${name}" takes ${expected} argument(s), received ${args.length}`);
    }
  };

  const operand = (value: ProtocolExpression): string => {
    switch (value.kind) {
      case 'reference':
        return reference(String(value.name));
      case 'binary':
        if (!BINARY.has(value.operator)) {
          throw unsupported(`unsupported operator "${value.operator}"`);
        }
        helpers.add(value.operator);
        return `${value.operator}(${operand(value.left)}, ${operand(value.right)})`;
      case 'call': {
        const name = String(value.function);
        helpers.add(name);
        switch (name) {
          case 'nullIfZero':
          case 'floor':
          case 'ceil':
            arity(value.args, 1, name);
            return `${name}(${operand(value.args[0])})`;
          case 'round':
            arity(value.args, 2, name);
            return `round(${operand(value.args[0])}, ${numeric(value.args[1], 'a "round" precision')})`;
          case 'coalesce': {
            arity(value.args, 2, name);
            const fallback = value.args[1];
            const second = fallback.kind === 'literal'
              ? numeric(fallback, 'a "coalesce" fallback literal')
              : operand(fallback);
            return `coalesce(${operand(value.args[0])}, ${second})`;
          }
          default:
            throw unsupported(`unsupported function "${name}"`);
        }
      }
      default:
        throw unsupported(`a formula cannot contain a "${value.kind}" expression here`);
    }
  };

  if (expression.kind === 'reference') {
    throw unsupported('a formula must combine its inputs rather than name one');
  }
  const body = operand(expression);
  const parameter = destructure
    ? referenced.size === 0 ? '()' : `({ ${aliases.filter(alias => referenced.has(alias)).join(', ')} })`
    : referenced.size === 0 ? '()' : '(inputs)';
  return { code: `${parameter} => ${body}`, helpers };
}
