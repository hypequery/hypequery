/**
 * RFC 0026 formula nodes as derived measures.
 *
 * A formula calculation becomes an ordinary derived measure of the query's
 * dataset view, so the derived and time-measure planners render it through
 * the same dialect formula renderer model-level derived measures use.
 */

import type { SemanticExpression } from '../semantic-plan.js';
import type { DerivedMeasureDefinition, FormulaExpr } from '../types.js';
import type { QueryFormulaArgument, QueryFormulaNode } from './query-calculation-types.js';

const BINARY = new Set(['add', 'subtract', 'multiply', 'divide']);
const BINARY_SQL: Readonly<Record<string, string>> = { add: '+', subtract: '-', multiply: '*', divide: '/' };

/** Every reference a formula makes, in first-use order. */
export function formulaReferences(node: QueryFormulaNode): string[] {
  const names: string[] = [];
  const visit = (arg: QueryFormulaArgument) => {
    if (typeof arg === 'string') {
      if (!names.includes(arg)) names.push(arg);
    } else if (typeof arg === 'object' && arg !== null) {
      arg.args.forEach(visit);
    }
  };
  node.args.forEach(visit);
  return names;
}

function expression(arg: QueryFormulaArgument, ref: (name: string) => string): SemanticExpression {
  if (typeof arg === 'string') return { kind: 'ref', name: ref(arg) };
  if (typeof arg === 'number') return { kind: 'literal', value: arg };
  const args = arg.args.map(child => expression(child, ref));
  if (arg.op === 'percentChange') {
    const [current, previous] = args as [SemanticExpression, SemanticExpression];
    return {
      kind: 'binary',
      operator: 'divide',
      left: { kind: 'binary', operator: 'subtract', left: current, right: previous },
      right: { kind: 'function', name: 'nullIfZero', args: [previous] },
    };
  }
  if (BINARY.has(arg.op)) {
    const [left, right] = args as [SemanticExpression, SemanticExpression];
    return { kind: 'binary', operator: arg.op as 'add', left, right };
  }
  return { kind: 'function', name: arg.op as 'nullIfZero', args };
}

/** Generic SQL for `FormulaExpr.toSQL`; planners render through the dialect instead. */
function expressionSql(node: SemanticExpression): string {
  switch (node.kind) {
    case 'ref': return node.name;
    case 'literal': return String(node.value);
    case 'binary': return `(${expressionSql(node.left)}) ${BINARY_SQL[node.operator]} (${expressionSql(node.right)})`;
    case 'function': {
      const name = node.name === 'nullIfZero' ? 'NULLIF' : node.name.toUpperCase();
      const args = node.args.map(expressionSql);
      return node.name === 'nullIfZero' ? `${name}(${args[0]}, 0)` : `${name}(${args.join(', ')})`;
    }
  }
}

/**
 * A derived measure computing `node`. `resolve` maps each reference to the
 * measure it reads (a selected measure, or an earlier calculation's internal
 * name). Each input is its own alias, so the formula honours whatever names a
 * planner passes for them.
 */
export function formulaMeasure(
  node: QueryFormulaNode,
  resolve: (name: string) => string,
): DerivedMeasureDefinition {
  const uses: Record<string, string> = {};
  for (const name of formulaReferences(node)) uses[resolve(name)] = resolve(name);
  return {
    __type: 'derived_measure_definition',
    uses,
    formula: (inputs: Readonly<Record<string, string>>): FormulaExpr => {
      const built = expression(node, name => inputs[resolve(name)] ?? resolve(name));
      return { __type: 'formula_expr', expression: built, toSQL: () => expressionSql(built) };
    },
  };
}
