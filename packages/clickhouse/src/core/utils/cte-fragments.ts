import type { DatabaseAdapter } from '../adapters/database-adapter.js';
import type { CteNode } from '../../types/index.js';
import { substituteParameters } from '../utils.js';

/**
 * Renders a CTE body to a standalone string with its values inlined, following
 * the same path `toSQL()` uses so adapter-specific rendering is preserved.
 */
export function renderCteBody(
  body: string,
  parameters: readonly unknown[],
  adapter: DatabaseAdapter,
): string {
  return adapter.render
    ? adapter.render(body, [...parameters])
    : substituteParameters(body, parameters);
}

/**
 * The compilable form of a CTE entry. Structured entries keep their parameters
 * bound; entries that predate the structured fields fall back to the rendered
 * `expression`, which has its values already inlined.
 */
export function cteFragment(node: CteNode): { sql: string; parameters: readonly unknown[] } {
  return node.name !== undefined && node.body !== undefined
    ? { sql: `${node.name} AS (${node.body})`, parameters: node.parameters ?? [] }
    : { sql: node.expression, parameters: [] };
}
