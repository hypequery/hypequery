/**
 * Formula helpers for derived metrics.
 *
 * These are symbolic — they build FormulaExpr objects that get compiled to SQL
 * by the MetricExecutor. They do not produce raw SQL strings directly.
 *
 * @example
 * ```ts
 * const avgOrderValue = Orders.metric("avgOrderValue", {
 *   uses: { revenue: totalRevenue, orders: orderCount },
 *   formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
 * });
 * ```
 */

import type { FormulaExpr } from './types.js';
import type { SemanticExpression } from './semantic-plan.js';

function expr(expression: SemanticExpression, sqlFn: () => string): FormulaExpr {
  return { __type: 'formula_expr', expression, toSQL: sqlFn };
}

/** Check if a value is a FormulaExpr. */
function resolveArg(a: string | FormulaExpr): string {
  if (typeof a === 'string') return a;
  return a.toSQL();
}

function isFormulaExpr(value: unknown): value is FormulaExpr {
  return typeof value === 'object'
    && value !== null
    && '__type' in value
    && value.__type === 'formula_expr';
}

function resolveExpression(a: string | number | boolean | null | FormulaExpr): SemanticExpression {
  if (isFormulaExpr(a)) {
    return a.expression;
  }
  if (typeof a === 'string') {
    return { kind: 'ref', name: a };
  }
  return { kind: 'literal', value: a };
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function divide(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'binary', operator: 'divide', left: resolveExpression(a), right: resolveExpression(b) },
    () => `(${resolveArg(a)}) / (${resolveArg(b)})`,
  );
}

export function multiply(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'binary', operator: 'multiply', left: resolveExpression(a), right: resolveExpression(b) },
    () => `(${resolveArg(a)}) * (${resolveArg(b)})`,
  );
}

export function subtract(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'binary', operator: 'subtract', left: resolveExpression(a), right: resolveExpression(b) },
    () => `(${resolveArg(a)}) - (${resolveArg(b)})`,
  );
}

export function add(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'binary', operator: 'add', left: resolveExpression(a), right: resolveExpression(b) },
    () => `(${resolveArg(a)}) + (${resolveArg(b)})`,
  );
}

// ---------------------------------------------------------------------------
// Null handling
// ---------------------------------------------------------------------------

export function nullIfZero(a: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'function', name: 'nullIfZero', args: [resolveExpression(a)] },
    () => `NULLIF(${resolveArg(a)}, 0)`,
  );
}

export function coalesce(a: string | FormulaExpr, fallback: number | string | FormulaExpr): FormulaExpr {
  const fb = typeof fallback === 'number' ? String(fallback) : resolveArg(fallback);
  return expr(
    { kind: 'function', name: 'coalesce', args: [resolveExpression(a), resolveExpression(fallback)] },
    () => `COALESCE(${resolveArg(a)}, ${fb})`,
  );
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

export function round(a: string | FormulaExpr, decimals: number = 0): FormulaExpr {
  return expr(
    { kind: 'function', name: 'round', args: [resolveExpression(a), resolveExpression(decimals)] },
    () => `ROUND(${resolveArg(a)}, ${decimals})`,
  );
}

export function floor(a: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'function', name: 'floor', args: [resolveExpression(a)] },
    () => `FLOOR(${resolveArg(a)})`,
  );
}

export function ceil(a: string | FormulaExpr): FormulaExpr {
  return expr(
    { kind: 'function', name: 'ceil', args: [resolveExpression(a)] },
    () => `CEIL(${resolveArg(a)})`,
  );
}
