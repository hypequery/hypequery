/**
 * Column introspection that also covers parameterized views.
 *
 * `DESCRIBE TABLE` and `system.columns` return no columns for a view whose
 * query has `{name:Type}` parameters, so its generated type would be empty.
 * Describing a call to the view with each parameter's default value
 * (`defaultValueOfTypeName('Type')`) returns the real columns: `DESCRIBE`
 * analyses the query without running it.
 */
import type { TypeGenerationClickHouseClient } from './generate-types.js';

export interface ViewParameter {
  name: string;
  type: string;
}

export interface DescribedRelation {
  columns: Array<Record<string, string>>;
  /** Present only for a parameterized view, in declaration order. */
  parameters?: ViewParameter[];
}

const QUERY_PARAMETER = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^{}]+?)\s*\}/g;

/** The `{name:Type}` parameters in a view's CREATE query, first occurrence of each name. */
export function parseViewParameters(createQuery: string): ViewParameter[] {
  const seen = new Map<string, string>();
  for (const match of createQuery.matchAll(QUERY_PARAMETER)) {
    if (!seen.has(match[1])) seen.set(match[1], match[2]);
  }
  return [...seen].map(([name, type]) => ({ name, type }));
}

function quoteIdentifier(name: string): string {
  return `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `DESCRIBE (SELECT * FROM view(p = defaultValueOfTypeName('T'), ...))`. */
export function describeParameterizedViewQuery(viewName: string, parameters: ViewParameter[]): string {
  const args = parameters
    .map(({ name, type }) => `${quoteIdentifier(name)} = defaultValueOfTypeName(${quoteString(type)})`)
    .join(', ');
  return `DESCRIBE (SELECT * FROM ${quoteIdentifier(viewName)}(${args}))`;
}

async function rows(client: TypeGenerationClickHouseClient, query: string) {
  const result = await client.query({ query, format: 'JSONEachRow' });
  return result.json();
}

export async function describeRelation(
  client: TypeGenerationClickHouseClient,
  tableName: string,
): Promise<DescribedRelation> {
  const columns = await rows(client, `DESCRIBE TABLE ${tableName}`);
  if (columns.length > 0) return { columns };

  const [definition] = await rows(
    client,
    `SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND name = ${quoteString(tableName)}`,
  );
  const parameters = parseViewParameters(definition?.create_table_query ?? '');
  if (parameters.length === 0) return { columns };

  return {
    columns: await rows(client, describeParameterizedViewQuery(tableName, parameters)),
    parameters,
  };
}
