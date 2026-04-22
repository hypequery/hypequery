import { createHash } from 'node:crypto';
import { isSQLExpression } from '../../dataset/sql-tag.js';
import type {
  ClickHouseColumnType,
  ClickHouseSchemaAst,
  ClickHouseSqlExpression,
} from '../schema/types.js';
import type {
  Snapshot,
  SnapshotColumn,
  SnapshotDependencyEdge,
  SnapshotMaterializedView,
  SnapshotTable,
} from './types.js';

type SnapshotWithoutHash = Omit<Snapshot, 'contentHash'>;

export function serializeSchemaToSnapshot(schema: ClickHouseSchemaAst): Snapshot {
  const snapshot: SnapshotWithoutHash = {
    version: 1,
    dialect: 'clickhouse',
    tables: [...schema.tables]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((table): SnapshotTable => ({
        name: table.name,
        columns: [...table.columns]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(
            (column): SnapshotColumn => ({
              name: column.name,
              type: normalizeColumnType(column.type),
              ...(column.default !== undefined
                ? { default: normalizeSqlExpression(column.default) }
                : {}),
            }),
          ),
        engine: {
          type: table.engine.type,
          orderBy: (table.engine.orderBy ?? []).map(normalizeSqlExpression),
          ...(table.engine.partitionBy !== undefined
            ? { partitionBy: normalizeSqlExpression(table.engine.partitionBy) }
            : {}),
          primaryKey: (table.engine.primaryKey ?? []).map(normalizeSqlExpression),
          ...(table.engine.sampleBy !== undefined
            ? { sampleBy: normalizeSqlExpression(table.engine.sampleBy) }
            : {}),
        },
        settings: Object.fromEntries(
          Object.entries(table.settings ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, String(value)]),
        ),
      })),
    materializedViews: [...(schema.materializedViews ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(
        (view): SnapshotMaterializedView => ({
          name: view.name,
          from: view.from,
          ...(view.to !== undefined ? { to: view.to } : {}),
          select: normalizeSqlExpression(view.select),
        }),
      ),
    dependencies: [...(schema.materializedViews ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(
        (view): SnapshotDependencyEdge => ({
          from: view.from,
          to: view.name,
          kind: 'table_to_materialized_view',
        }),
      ),
  };

  return {
    ...snapshot,
    contentHash: hashSnapshot(snapshot),
  };
}

export function snapshotToStableJson(snapshot: Snapshot | SnapshotWithoutHash): string {
  return JSON.stringify(snapshot, null, 2);
}

export function hashSnapshot(snapshot: Snapshot | SnapshotWithoutHash): string {
  return createHash('sha256').update(snapshotToStableJson(snapshot)).digest('hex');
}

function normalizeColumnType(type: ClickHouseColumnType): string {
  switch (type.kind) {
    case 'named': {
      const args = type.arguments?.length ? `(${type.arguments.join(', ')})` : '';
      return `${type.name}${args}`;
    }
    case 'nullable':
      return `Nullable(${normalizeColumnType(type.inner)})`;
    case 'low_cardinality':
      return `LowCardinality(${normalizeColumnType(type.inner)})`;
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
}

function normalizeSqlExpression(expression: ClickHouseSqlExpression): string {
  const sql = typeof expression === 'string'
    ? expression
    : isSQLExpression(expression)
      ? expression.sql
      : String(expression);

  const lines = sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/g, ''));

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const indents = lines
    .filter(line => line.trim().length > 0)
    .map(line => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map(line => line.slice(minIndent))
    .join('\n')
    .trim();
}
