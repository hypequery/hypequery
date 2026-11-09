/**
 * Column introspection that also covers parameterized views. `DESCRIBE TABLE`
 * returns no columns for a view whose query has `{name:Type}` parameters;
 * describing a call with each parameter's default value returns them, and
 * `DESCRIBE` analyses the query without running it. Mirrors
 * `@hypequery/cli`'s `typegen/describe-relation.ts`.
 */

const QUERY_PARAMETER = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^{}]+?)\s*\}/g;

/** @returns {Array<{ name: string, type: string }>} */
export function parseViewParameters(createQuery) {
  const seen = new Map();
  for (const match of createQuery.matchAll(QUERY_PARAMETER)) {
    if (!seen.has(match[1])) seen.set(match[1], match[2]);
  }
  return [...seen].map(([name, type]) => ({ name, type }));
}

const quoteIdentifier = name => `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
const quoteString = value => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function describeParameterizedViewQuery(viewName, parameters) {
  const args = parameters
    .map(({ name, type }) => `${quoteIdentifier(name)} = defaultValueOfTypeName(${quoteString(type)})`)
    .join(', ');
  return `DESCRIBE (SELECT * FROM ${quoteIdentifier(viewName)}(${args}))`;
}

async function rows(client, query) {
  const result = await client.query({ query, format: 'JSONEachRow' });
  return result.json();
}

/** @returns {Promise<{ columns: Array<Record<string, string>>, parameters?: Array<{ name: string, type: string }> }>} */
export async function describeRelation(client, tableName) {
  const columns = await rows(client, `DESCRIBE TABLE ${tableName}`);
  if (columns.length > 0) return { columns };

  const [definition] = await rows(
    client,
    `SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND name = ${quoteString(tableName)}`,
  );
  const parameters = parseViewParameters(definition?.create_table_query ?? '');
  if (parameters.length === 0) return { columns };

  return { columns: await rows(client, describeParameterizedViewQuery(tableName, parameters)), parameters };
}
