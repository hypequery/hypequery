import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import ora from 'ora';
import {
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  type ClickHouseSchemaAst,
  type ClickHouseColumnDefaultValue,
  type ClickHouseColumnType,
} from '@hypequery/clickhouse';
import { logger } from '../utils/logger.js';
import { DEFAULT_HYPEQUERY_CONFIG_PATH } from '../utils/load-hypequery-config.js';
import { ensureDir, loadConfigOrExit } from './migration-pipeline.js';

interface PullOptions {
  config?: string;
  force?: boolean;
}

interface IntrospectedTableRow {
  name: string;
  engine: string;
  sorting_key: string;
  primary_key: string;
  partition_key: string;
  sampling_key: string;
  create_table_query: string;
}

interface IntrospectedColumnRow {
  table: string;
  name: string;
  type: string;
  default_kind?: string | null;
  default_expression?: string | null;
  position?: number;
}

interface IntrospectedMaterializedViewRow {
  name: string;
}

interface BaselineTableDefinition {
  name: string;
  columns: Array<{
    name: string;
    type: ClickHouseColumnType;
    default?: ClickHouseColumnDefaultValue;
  }>;
  engine: {
    type: string;
    orderBy?: string[];
    partitionBy?: string;
    primaryKey?: string[];
    sampleBy?: string;
  };
  settings?: Record<string, string | number | boolean>;
}

export async function pullCommand(options: PullOptions = {}) {
  const configPath = options.config ?? DEFAULT_HYPEQUERY_CONFIG_PATH;

  logger.newline();
  logger.header('hypequery pull');

  const config = await loadConfigOrExit(configPath);
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const schemaPath = path.resolve(configDir, config.schema);
  const migrationsOutDir = path.resolve(configDir, config.migrations.out);
  const migrationsMetaDir = path.join(migrationsOutDir, 'meta');
  const baselineSnapshotPath = path.join(migrationsMetaDir, '0000_snapshot.json');

  if (!options.force) {
    await assertMissingBaseline(schemaPath, baselineSnapshotPath);
  }

  const spinner = ora('Introspecting ClickHouse schema...').start();
  const client = createClient({
    url: toClickHouseUrl(config.dbCredentials),
    username: config.dbCredentials.username,
    password: config.dbCredentials.password ?? '',
    database: config.dbCredentials.database,
  });

  try {
    const [tables, columns, materializedViews] = await Promise.all([
      queryJson<IntrospectedTableRow>(client, `
        SELECT
          name,
          engine,
          sorting_key,
          primary_key,
          partition_key,
          sampling_key,
          create_table_query
        FROM system.tables
        WHERE database = {database:String}
          AND is_temporary = 0
          AND engine != 'MaterializedView'
        ORDER BY name
      `, { database: config.dbCredentials.database }),
      queryJson<IntrospectedColumnRow>(client, `
        SELECT
          table,
          name,
          type,
          default_kind,
          default_expression,
          position
        FROM system.columns
        WHERE database = {database:String}
        ORDER BY table, position, name
      `, { database: config.dbCredentials.database }),
      queryJson<IntrospectedMaterializedViewRow>(client, `
        SELECT name
        FROM system.tables
        WHERE database = {database:String}
          AND engine = 'MaterializedView'
        ORDER BY name
      `, { database: config.dbCredentials.database }),
    ]);

    const baselineTables = buildBaselineTables(tables, columns);
    const schemaAst: ClickHouseSchemaAst = {
      tables: baselineTables.map(table => ({
        kind: 'table' as const,
        name: table.name,
        columns: table.columns,
        engine: table.engine,
        ...(table.settings !== undefined ? { settings: table.settings } : {}),
      })),
    };
    const snapshot = serializeSchemaToSnapshot(schemaAst);
    const schemaSource = renderBaselineSchema(baselineTables, materializedViews.map(view => view.name));

    await ensureDir(path.dirname(schemaPath));
    await ensureDir(migrationsMetaDir);
    await writeFile(schemaPath, schemaSource, 'utf8');
    await writeFile(baselineSnapshotPath, `${snapshotToStableJson(snapshot)}\n`, 'utf8');

    spinner.succeed('Wrote migration baseline');
    logger.success(`Schema file: ${path.relative(process.cwd(), schemaPath)}`);
    logger.success(`Baseline snapshot: ${path.relative(process.cwd(), baselineSnapshotPath)}`);
    logger.info(`Captured ${baselineTables.length} table(s)`);
    if (materializedViews.length > 0) {
      logger.warn(
        `Skipped ${materializedViews.length} materialized view(s). Review the emitted TODOs before generating migrations.`,
      );
    }
    logger.newline();
  } catch (error) {
    spinner.fail('Failed to pull ClickHouse schema');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function assertMissingBaseline(schemaPath: string, baselineSnapshotPath: string) {
  const existingPaths: string[] = [];

  if (await exists(schemaPath)) {
    existingPaths.push(path.relative(process.cwd(), schemaPath));
  }

  if (await exists(baselineSnapshotPath)) {
    existingPaths.push(path.relative(process.cwd(), baselineSnapshotPath));
  }

  if (existingPaths.length > 0) {
    logger.error(
      `Baseline already exists: ${existingPaths.join(', ')}. Re-run with --force to overwrite it.`,
    );
    process.exit(1);
  }
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toClickHouseUrl(credentials: {
  host: string;
  port?: number;
  secure?: boolean;
}) {
  if (/^https?:\/\//i.test(credentials.host)) {
    return credentials.host;
  }

  const protocol = credentials.secure ? 'https' : 'http';
  const port = credentials.port ? `:${credentials.port}` : '';
  return `${protocol}://${credentials.host}${port}`;
}

async function queryJson<Row>(
  client: ClickHouseClient,
  query: string,
  query_params: Record<string, unknown>,
) {
  const result = await client.query({
    query,
    format: 'JSONEachRow',
    query_params,
  });

  return await result.json() as Row[];
}

function buildBaselineTables(
  tables: IntrospectedTableRow[],
  columns: IntrospectedColumnRow[],
): BaselineTableDefinition[] {
  const columnsByTable = new Map<string, IntrospectedColumnRow[]>();

  for (const column of columns) {
    const current = columnsByTable.get(column.table) ?? [];
    current.push(column);
    columnsByTable.set(column.table, current);
  }

  return tables.map((table) => ({
    name: table.name,
    columns: (columnsByTable.get(table.name) ?? [])
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((column) => ({
        name: column.name,
        type: parseColumnType(column.type),
        ...(toColumnDefault(column.default_kind, column.default_expression) !== undefined
          ? { default: toColumnDefault(column.default_kind, column.default_expression)! }
          : {}),
      })),
    engine: {
      type: table.engine,
      ...(parseExpressionList(table.sorting_key).length > 0
        ? { orderBy: parseExpressionList(table.sorting_key) }
        : {}),
      ...(table.partition_key.trim() !== '' ? { partitionBy: normalizeExpression(table.partition_key) } : {}),
      ...(parseExpressionList(table.primary_key).length > 0
        ? { primaryKey: parseExpressionList(table.primary_key) }
        : {}),
      ...(table.sampling_key.trim() !== '' ? { sampleBy: normalizeExpression(table.sampling_key) } : {}),
    },
    ...(parseSettings(table.create_table_query) !== undefined
      ? { settings: parseSettings(table.create_table_query) }
      : {}),
  }));
}

function parseColumnType(type: string): ClickHouseColumnType {
  const nullableInner = unwrapType(type, 'Nullable');
  if (nullableInner) {
    return {
      kind: 'nullable',
      inner: parseColumnType(nullableInner),
    };
  }

  const lowCardinalityInner = unwrapType(type, 'LowCardinality');
  if (lowCardinalityInner) {
    return {
      kind: 'low_cardinality',
      inner: parseColumnType(lowCardinalityInner),
    };
  }

  const namedMatch = /^([A-Za-z0-9_]+)(?:\((.*)\))?$/.exec(type.trim());
  if (!namedMatch) {
    return {
      kind: 'named',
      name: type.trim(),
    };
  }

  const [, name, rawArgs] = namedMatch;
  return {
    kind: 'named',
    name,
    ...(rawArgs !== undefined && rawArgs.trim() !== ''
      ? { arguments: parseTypeArguments(rawArgs) }
      : {}),
  };
}

function unwrapType(type: string, wrapper: string) {
  const prefix = `${wrapper}(`;
  const trimmed = type.trim();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(')')) {
    return null;
  }

  return trimmed.slice(prefix.length, -1);
}

function parseTypeArguments(value: string): Array<string | number> {
  return splitTopLevel(value).map((entry) => {
    const trimmed = entry.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    return trimmed.replace(/^'([\s\S]*)'$/, '$1');
  });
}

function toColumnDefault(
  defaultKind: string | null | undefined,
  defaultExpression: string | null | undefined,
): ClickHouseColumnDefaultValue | undefined {
  if (!defaultExpression || defaultExpression.trim() === '') {
    return undefined;
  }

  if (!defaultKind || defaultKind === 'DEFAULT') {
    const parsedLiteral = parseLiteralDefault(defaultExpression);
    if (parsedLiteral !== undefined) {
      return {
        kind: 'literal',
        value: parsedLiteral,
      };
    }

    return {
      kind: 'sql',
      value: normalizeExpression(defaultExpression),
    };
  }

  return {
    kind: 'sql',
    value: normalizeExpression(defaultExpression),
  };
}

function parseLiteralDefault(expression: string) {
  const trimmed = expression.trim();

  if (/^null$/i.test(trimmed)) {
    return null;
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith('\'') && trimmed.endsWith('\'')) {
    return trimmed.slice(1, -1).replace(/''/g, '\'');
  }

  return undefined;
}

function parseExpressionList(value: string) {
  const normalized = normalizeExpression(value);
  if (normalized === '' || normalized === 'tuple()') {
    return [];
  }

  const unwrapped = unwrapOuterParens(normalized);
  return splitTopLevel(unwrapped)
    .map(part => normalizeExpression(part))
    .filter(Boolean);
}

function normalizeExpression(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function unwrapOuterParens(value: string) {
  if (value.startsWith('(') && value.endsWith(')')) {
    const inner = value.slice(1, -1);
    if (splitTopLevel(inner).length > 1 || balanced(inner)) {
      return inner;
    }
  }

  return value;
}

function balanced(value: string) {
  let depth = 0;
  let quote: '\'' | '"' | null = null;

  for (const char of value) {
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0 && quote === null;
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '\'' | '"' | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      if (current.trim() !== '') {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() !== '') {
    parts.push(current.trim());
  }

  return parts;
}

function parseSettings(createTableQuery: string): Record<string, string | number | boolean> | undefined {
  const match = /\bSETTINGS\b\s+([\s\S]+?)\s*;?\s*$/i.exec(createTableQuery);
  if (!match) {
    return undefined;
  }

  const settings = Object.fromEntries(
    splitTopLevel(match[1]).flatMap((entry) => {
      const equalsIndex = entry.indexOf('=');
      if (equalsIndex === -1) {
        return [];
      }

      const key = entry.slice(0, equalsIndex).trim();
      const rawValue = entry.slice(equalsIndex + 1).trim();
      return [[key, parseSettingValue(rawValue)]];
    }),
  );

  return Object.keys(settings).length > 0 ? settings : undefined;
}

function parseSettingValue(value: string): string | number | boolean {
  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true';
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function renderBaselineSchema(tables: BaselineTableDefinition[], skippedMaterializedViews: string[]) {
  const lines: string[] = [
    '// Generated by hypequery pull',
    '// Review this baseline before generating migrations.',
    '',
    "import { ClickHouseColumnBuilder, column, defineSchema, defineTable, sql } from '@hypequery/clickhouse';",
    '',
    "const rawType = (type: string) => new ClickHouseColumnBuilder({ kind: 'named', name: type });",
    '',
  ];

  for (const table of tables) {
    lines.push(`const ${toIdentifier(table.name)} = defineTable(${JSON.stringify(table.name)}, {`);
    lines.push('  columns: {');
    for (const column of table.columns) {
      lines.push(`    ${quoteProperty(column.name)}: ${renderColumnBuilder(column.type, column.default)},`);
    }
    lines.push('  },');
    lines.push('  engine: {');
    lines.push(`    type: ${JSON.stringify(table.engine.type)},`);
    if (table.engine.orderBy && table.engine.orderBy.length > 0) {
      lines.push(`    orderBy: [${table.engine.orderBy.map(expr => JSON.stringify(expr)).join(', ')}],`);
    }
    if (table.engine.partitionBy) {
      lines.push(`    partitionBy: sql\`${escapeTemplateLiteral(table.engine.partitionBy)}\`,`);
    }
    if (table.engine.primaryKey && table.engine.primaryKey.length > 0) {
      lines.push(`    primaryKey: [${table.engine.primaryKey.map(expr => JSON.stringify(expr)).join(', ')}],`);
    }
    if (table.engine.sampleBy) {
      lines.push(`    sampleBy: sql\`${escapeTemplateLiteral(table.engine.sampleBy)}\`,`);
    }
    lines.push('  },');
    if (table.settings && Object.keys(table.settings).length > 0) {
      lines.push('  settings: {');
      for (const [key, value] of Object.entries(table.settings)) {
        lines.push(`    ${key}: ${renderPrimitive(value)},`);
      }
      lines.push('  },');
    }
    lines.push('});');
    lines.push('');
  }

  lines.push('export default defineSchema({');
  lines.push(`  tables: [${tables.map(table => toIdentifier(table.name)).join(', ')}],`);
  if (skippedMaterializedViews.length > 0) {
    lines.push('  // TODO: Materialized views were detected but are not emitted yet.');
    for (const viewName of skippedMaterializedViews) {
      lines.push(`  // - ${viewName}`);
    }
  }
  lines.push('});');
  lines.push('');

  return `${lines.join('\n')}`;
}

function renderColumnBuilder(type: ClickHouseColumnType, defaultValue?: ClickHouseColumnDefaultValue) {
  let source = renderColumnTypeBuilder(type);

  if (defaultValue) {
    if (defaultValue.kind === 'literal') {
      source += `.default(${renderPrimitive(defaultValue.value)})`;
    } else {
      source += `.default(sql\`${escapeTemplateLiteral(defaultValue.value as string)}\`)`;
    }
  }

  return source;
}

function renderColumnTypeBuilder(type: ClickHouseColumnType): string {
  switch (type.kind) {
    case 'nullable':
      return `${renderColumnTypeBuilder(type.inner)}.nullable()`;
    case 'low_cardinality':
      return `${renderColumnTypeBuilder(type.inner)}.lowCardinality()`;
    case 'named':
      return renderNamedTypeBuilder(type.name, type.arguments);
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
}

function renderNamedTypeBuilder(name: string, args?: Array<string | number>) {
  const methodMap = new Set([
    'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256',
    'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256',
    'Float32', 'Float64', 'Decimal', 'String', 'FixedString',
    'Date', 'DateTime', 'DateTime64', 'UUID', 'JSON',
  ]);

  if (!methodMap.has(name)) {
    return `rawType(${JSON.stringify(renderNamedType(name, args))})`;
  }

  if (!args || args.length === 0) {
    return `column.${name}()`;
  }

  return `column.${name}(${args.map(renderPrimitive).join(', ')})`;
}

function renderNamedType(name: string, args?: Array<string | number>) {
  return args && args.length > 0
    ? `${name}(${args.map((arg) => typeof arg === 'string' ? `'${arg}'` : String(arg)).join(', ')})`
    : name;
}

function renderPrimitive(value: string | number | boolean | null) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (value === null) {
    return 'null';
  }

  return String(value);
}

function quoteProperty(name: string) {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(name) ? name : JSON.stringify(name);
}

function toIdentifier(name: string) {
  const base = name
    .replace(/[^a-zA-Z0-9_$]+/g, '_')
    .replace(/^[^a-zA-Z_$]+/, '_')
    .replace(/^$/, 'table');
  return `${base}Table`;
}

function escapeTemplateLiteral(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
