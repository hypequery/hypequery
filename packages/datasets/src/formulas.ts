/**
 * Formula helpers for derived metrics.
 *
 * These are symbolic — they build neutral expression trees that database
 * backends render into their own query dialect.
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

function expr(expression: SemanticExpression): FormulaExpr {
  return { __type: 'formula_expr', expression };
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
  return expr({ kind: 'binary', operator: 'divide', left: resolveExpression(a), right: resolveExpression(b) });
}

export function multiply(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'binary', operator: 'multiply', left: resolveExpression(a), right: resolveExpression(b) });
}

export function subtract(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'binary', operator: 'subtract', left: resolveExpression(a), right: resolveExpression(b) });
}

export function add(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'binary', operator: 'add', left: resolveExpression(a), right: resolveExpression(b) });
}

// ---------------------------------------------------------------------------
// Null handling
// ---------------------------------------------------------------------------

export function nullIfZero(a: string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'function', name: 'nullIfZero', args: [resolveExpression(a)] });
}

export function coalesce(a: string | FormulaExpr, fallback: number | string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'function', name: 'coalesce', args: [resolveExpression(a), resolveExpression(fallback)] });
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

export function round(a: string | FormulaExpr, decimals: number = 0): FormulaExpr {
  return expr({ kind: 'function', name: 'round', args: [resolveExpression(a), resolveExpression(decimals)] });
}

export function floor(a: string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'function', name: 'floor', args: [resolveExpression(a)] });
}

export function ceil(a: string | FormulaExpr): FormulaExpr {
  return expr({ kind: 'function', name: 'ceil', args: [resolveExpression(a)] });
}
