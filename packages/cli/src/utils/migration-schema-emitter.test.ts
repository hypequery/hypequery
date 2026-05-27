import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@hypequery/schema';
import { renderSchemaFile } from './migration-schema-emitter.js';

describe('migration schema emitter', () => {
  it('renders supported columns and SQL defaults', () => {
    const contents = renderSchemaFile(snapshotFixture());

    expect(contents).toContain("import { column, defineSchema, defineTable, sql } from '@hypequery/schema';");
    expect(contents).toContain('id: column.UUID(),');
    expect(contents).toContain('created_at: column.DateTime().default(sql`now()`),');
    expect(contents).toContain('orderBy: ["created_at"],');
    expect(contents).toContain('index_granularity: "8192",');
  });

  it('renders materialized views with SQL-preserved SELECT text', () => {
    const contents = renderSchemaFile({
      ...snapshotFixture(),
      materializedViews: [
        {
          name: 'events_mv',
          from: 'events',
          to: 'events_daily',
          select: 'SELECT toDate(created_at) AS date, count() AS total FROM events GROUP BY date',
        },
      ],
      dependencies: [
        {
          from: 'events',
          to: 'events_mv',
          kind: 'table_to_materialized_view',
        },
      ],
    });

    expect(contents).toContain("import { column, defineSchema, defineTable, defineMaterializedView, sql } from '@hypequery/schema';");
    expect(contents).toContain('materializedViews: [');
    expect(contents).toContain('defineMaterializedView("events_mv", {');
    expect(contents).toContain('from: "events",');
    expect(contents).toContain('to: "events_daily",');
    expect(contents).toContain('select: sql`SELECT toDate(created_at) AS date, count() AS total FROM events GROUP BY date`,');
  });

  it('preserves unsupported types with column.Raw and TODO comments', () => {
    const contents = renderSchemaFile({
      ...snapshotFixture(),
      tables: [
        {
          ...snapshotFixture().tables[0],
          columns: [
            { name: 'tags', type: 'Array(String)' },
          ],
        },
      ],
    });

    expect(contents).toContain('tags: column.Raw("Array(String)") /* TODO: Review unsupported ClickHouse type. */,');
  });

  it('emits scalar ClickHouse types supported by the migration DSL', () => {
    const contents = renderSchemaFile({
      ...snapshotFixture(),
      tables: [
        {
          ...snapshotFixture().tables[0],
          columns: [
            { name: 'active', type: 'Bool' },
            { name: 'created_date32', type: 'Date32' },
            { name: 'ip4', type: 'IPv4' },
            { name: 'ip6', type: 'IPv6' },
            { name: 'payload', type: 'JSON' },
          ],
        },
      ],
    });

    expect(contents).toContain('active: column.Bool(),');
    expect(contents).toContain('created_date32: column.Date32(),');
    expect(contents).toContain('ip4: column.IPv4(),');
    expect(contents).toContain('ip6: column.IPv6(),');
    expect(contents).toContain('payload: column.JSON(),');
  });
});

function snapshotFixture(): Snapshot {
  return {
    version: 1,
    dialect: 'clickhouse',
    contentHash: 'hash',
    dependencies: [],
    materializedViews: [],
    tables: [
      {
        name: 'events',
        columns: [
          { name: 'id', type: 'UUID' },
          { name: 'created_at', type: 'DateTime', default: { kind: 'sql', value: 'now()' } },
        ],
        engine: {
          type: 'MergeTree',
          orderBy: ['created_at'],
          primaryKey: [],
        },
        settings: {
          index_granularity: '8192',
        },
      },
    ],
  };
}
