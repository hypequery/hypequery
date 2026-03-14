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

function expr(sqlFn: () => string): FormulaExpr {
  return { __type: 'formula_expr', toSQL: sqlFn };
}

/** Check if a value is a FormulaExpr. */
function resolveArg(a: string | FormulaExpr): string {
  if (typeof a === 'string') return a;
  return a.toSQL();
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function divide(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(() => `(${resolveArg(a)}) / (${resolveArg(b)})`);
}

export function multiply(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(() => `(${resolveArg(a)}) * (${resolveArg(b)})`);
}

export function subtract(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(() => `(${resolveArg(a)}) - (${resolveArg(b)})`);
}

export function add(a: string | FormulaExpr, b: string | FormulaExpr): FormulaExpr {
  return expr(() => `(${resolveArg(a)}) + (${resolveArg(b)})`);
}

// ---------------------------------------------------------------------------
// Null handling
// ---------------------------------------------------------------------------

export function nullIfZero(a: string | FormulaExpr): FormulaExpr {
  return expr(() => `NULLIF(${resolveArg(a)}, 0)`);
}

export function coalesce(a: string | FormulaExpr, fallback: number | string | FormulaExpr): FormulaExpr {
  const fb = typeof fallback === 'number' ? String(fallback) : resolveArg(fallback);
  return expr(() => `COALESCE(${resolveArg(a)}, ${fb})`);
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

export function round(a: string | FormulaExpr, decimals: number = 0): FormulaExpr {
  return expr(() => `ROUND(${resolveArg(a)}, ${decimals})`);
}

export function floor(a: string | FormulaExpr): FormulaExpr {
  return expr(() => `FLOOR(${resolveArg(a)})`);
}

export function ceil(a: string | FormulaExpr): FormulaExpr {
  return expr(() => `CEIL(${resolveArg(a)})`);
}
