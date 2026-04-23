import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../diff/index.js';
import { column, defineMaterializedView, defineSchema, defineTable } from '../schema/index.js';
import { serializeSchemaToSnapshot } from '../snapshot/index.js';
import { renderMigrationArtifacts, writeMigrationArtifacts } from './index.js';

describe('render migration artifacts', () => {
  it('renders MV-safe up/down SQL and metadata for table alters', async () => {
    const orders = defineTable('orders', {
      columns: {
        id: column.UInt64(),
        created_at: column.DateTime(),
        total: column.Decimal(10, 2),
      },
      engine: {
        type: 'MergeTree',
        orderBy: ['created_at', 'id'],
      },
    });
    const ordersByDay = defineMaterializedView('orders_by_day', {
      from: orders,
      to: 'orders_daily_summary',
      select: `SELECT
  toDate(created_at) AS day,
  sum(total) AS revenue
FROM orders
GROUP BY day`,
    });

    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [orders],
        materializedViews: [ordersByDay],
      }),
    );

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('orders', {
            columns: {
              id: column.UInt64(),
              created_at: column.DateTime(),
              total: column.Decimal(10, 2),
              region: column.LowCardinality('String'),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['created_at', 'id'],
            },
          }),
        ],
        materializedViews: [
          defineMaterializedView('orders_by_day', {
            from: 'orders',
            to: 'orders_daily_summary',
            select: `SELECT
  toDate(created_at) AS day,
  region,
  sum(total) AS revenue
FROM orders
GROUP BY day, region`,
          }),
        ],
      }),
    );

    const artifacts = renderMigrationArtifacts(diffSnapshots(previousSnapshot, nextSnapshot), {
      name: 'add_order_region',
      timestamp: '20260422140000',
    });

    expect(artifacts.upSql).toBe(`DROP TABLE \`orders_by_day\`;

ALTER TABLE \`orders\` ADD COLUMN \`region\` LowCardinality(String);

CREATE MATERIALIZED VIEW \`orders_by_day\`
TO \`orders_daily_summary\` AS
SELECT
  toDate(created_at) AS day,
  region,
  sum(total) AS revenue
FROM orders
GROUP BY day, region
;`);
    expect(artifacts.downSql).toBe(`DROP TABLE \`orders_by_day\`;

ALTER TABLE \`orders\` DROP COLUMN \`region\`;

CREATE MATERIALIZED VIEW \`orders_by_day\`
TO \`orders_daily_summary\` AS
SELECT
  toDate(created_at) AS day,
  sum(total) AS revenue
FROM orders
GROUP BY day
;`);
    expect(artifacts.meta).toEqual({
      name: 'add_order_region',
      timestamp: '20260422140000',
      operations: [{ kind: 'AlterTableWithDependentViews', classification: 'metadata' }],
      sourceSnapshotHash: previousSnapshot.contentHash,
      targetSnapshotHash: nextSnapshot.contentHash,
      custom: false,
      unsafe: false,
      containsManualSteps: false,
    });

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hq-migration-render-'));
    const written = await writeMigrationArtifacts({
      outDir: tempDir,
      migrationName: '20260422140000_add_order_region',
      artifacts,
    });

    expect(await readFile(written.upPath, 'utf8')).toContain('ALTER TABLE `orders` ADD COLUMN `region`');
    expect(await readFile(written.metaPath, 'utf8')).toContain('"name": "add_order_region"');
    expect(await readFile(written.planPath, 'utf8')).toContain('"classification": "metadata"');
  });

  it('marks unsafe/manual down flows for non-reversible operations and renders cluster clauses', () => {
    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              email: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              email: column.Nullable('String'),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const artifacts = renderMigrationArtifacts(diffSnapshots(previousSnapshot, nextSnapshot), {
      name: 'unsafe_change',
      timestamp: '20260422150000',
      cluster: 'main_cluster',
    });

    expect(artifacts.upSql).toContain('ALTER TABLE `users` ON CLUSTER `main_cluster` MODIFY COLUMN `email` Nullable(String);');
    expect(artifacts.downSql).toContain('-- MANUAL STEP REQUIRED: revert type change for "users.email" manually');
    expect(artifacts.meta.operations).toEqual([{ kind: 'ModifyColumnType', classification: 'mutation' }]);
    expect(artifacts.meta.unsafe).toBe(true);
    expect(artifacts.meta.containsManualSteps).toBe(true);
    expect(artifacts.plan.requiredConfirmations).toEqual([
      expect.objectContaining({ kind: 'MutationRequiresConfirmation' }),
    ]);
  });

  it('preserves and escapes literal defaults while collapsing duplicate modify-column renders', () => {
    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              status: column.String(),
              string_code: column.String(),
              numeric_code: column.UInt64(),
              notes: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              status: column.LowCardinality('String').default('pending'),
              string_code: column.String().default('123'),
              numeric_code: column.UInt64().default(123),
              notes: column.String().default("line 1\nline '2'\t\\done"),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const artifacts = renderMigrationArtifacts(diffSnapshots(previousSnapshot, nextSnapshot), {
      name: 'change_status',
      timestamp: '20260422160000',
    });

    expect(artifacts.upSql).toBe(
      [
        "ALTER TABLE `users` MODIFY COLUMN `notes` String DEFAULT 'line 1\\nline \\'2\\'\\t\\\\done';",
        "ALTER TABLE `users` MODIFY COLUMN `numeric_code` UInt64 DEFAULT 123;",
        "ALTER TABLE `users` MODIFY COLUMN `status` LowCardinality(String) DEFAULT 'pending';",
        "ALTER TABLE `users` MODIFY COLUMN `string_code` String DEFAULT '123';",
      ].join('\n\n'),
    );
  });

  it('rejects unsupported diffs before rendering SQL', () => {
    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              email: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              email_address: column.String(),
            },
            engine: {
              type: 'ReplacingMergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    expect(() =>
      renderMigrationArtifacts(diffSnapshots(previousSnapshot, nextSnapshot), {
        name: 'unsupported',
        timestamp: '20260422170000',
      }),
    ).toThrow(/Use a custom SQL migration/);
  });

  it('rejects planner-level forbidden operations before rendering SQL', () => {
    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('events', {
            columns: {
              id: column.UInt64(),
              payload: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('events', {
            columns: {
              payload: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    expect(() =>
      renderMigrationArtifacts(diffSnapshots(previousSnapshot, nextSnapshot), {
        name: 'drop_key_column',
        timestamp: '20260422200000',
      }),
    ).toThrow(/Cannot drop key column "events\.id" automatically/);
  });

  it('rejects empty identifiers during rendering', () => {
    const previousSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('', {
            columns: {
              id: column.UInt64(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    expect(() =>
      renderMigrationArtifacts(diffSnapshots(previousSnapshot, nextSnapshot), {
        name: 'invalid_identifier',
        timestamp: '20260422180000',
      }),
    ).toThrow(/Invalid ClickHouse identifier/);
  });

  it('rejects migration names that are not single safe path segments', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hq-migration-render-'));
    const previousSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const artifacts = renderMigrationArtifacts(diffSnapshots(previousSnapshot, previousSnapshot), {
      name: 'noop',
      timestamp: '20260422190000',
    });

    await expect(
      writeMigrationArtifacts({
        outDir: tempDir,
        migrationName: '../escape',
        artifacts,
      }),
    ).rejects.toThrow(/Invalid migration name/);
  });
});
