import type { RelationshipBuilderContext } from './relationship-builder-plan.js';

/**
 * Raw SQL expressions on the base dataset are emitted verbatim, so their column
 * references are not table-qualified. When relationship joins are active a bare
 * `price` in such an expression is ambiguous if the joined table also has a
 * `price` column. Until the builder rewrites identifiers inside expressions,
 * reject the combination rather than emit ambiguous SQL.
 */
export function assertNoRawSqlUnderJoins(
  kind: 'dimension' | 'measure',
  name: string,
  sql: string,
  joinCtx?: RelationshipBuilderContext,
): void {
  if (!joinCtx) {
    return;
  }
  throw new Error(
    `SQL-backed ${kind} "${name}" cannot be combined with relationship joins: its expression ` +
    `("${sql}") is not table-qualified and may collide with joined columns. Query it without ` +
    `relationship-qualified fields, or redeclare it as a plain column.`,
  );
}
