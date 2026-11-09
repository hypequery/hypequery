/**
 * Column introspection that also covers parameterized views. `DESCRIBE TABLE`
 * returns no columns for a view whose query has `{name:Type}` parameters;
 * describing a call with each parameter's default value returns them, and
 * `DESCRIBE` analyses the query without running it. Mirrors
 * `@hypequery/cli`'s `typegen/describe-relation.ts`.
 */

// Scanned left to right: a `{name:Type}` placeholder in code, or a region that
// is not code (string literal, quoted identifier, heredoc, comment) to skip, so
// placeholder-shaped text inside a literal or comment is never read as a
// parameter. A type may itself contain a quoted string: DateTime64(3, 'UTC').
const PARAMETER_OR_NON_CODE = new RegExp([
  /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*((?:[^{}'"]|'(?:[^'\\]|\\.)*')+?)\s*\}/.source,
  /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|`(?:[^`\\]|\\.|``)*`/.source,
  /\$(?<tag>[A-Za-z0-9_]*)\$[\s\S]*?\$\k<tag>\$|--[^\n]*|\/\*[\s\S]*?\*\//.source,
].join('|'), 'g');

/** @returns {Array<{ name: string, type: string }>} */
export function parseViewParameters(createQuery) {
  const seen = new Map();
  for (const match of createQuery.matchAll(PARAMETER_OR_NON_CODE)) {
    const [, name, type] = match;
    if (name && type && !seen.has(name)) seen.set(name, type);
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
