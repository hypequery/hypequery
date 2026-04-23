import { describe, expect, it } from 'vitest';
import { column, defineMaterializedView, defineSchema, defineTable } from '../schema/index.js';
import { serializeSchemaToSnapshot } from '../snapshot/index.js';
import { diffSnapshots } from './index.js';

describe('diff snapshots', () => {
  it('handles empty snapshots without operations', () => {
    const previousSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const nextSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));

    expect(diffSnapshots(previousSnapshot, nextSnapshot)).toMatchObject({
      operations: [],
      warnings: [],
      unsupportedChanges: [],
    });
  });

  it('produces create and drop operations for top-level objects', () => {
    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('events', {
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

    const users = defineTable('users', {
      columns: {
        id: column.UInt64(),
      },
      engine: {
        type: 'MergeTree',
        orderBy: ['id'],
      },
    });
    const usersMv = defineMaterializedView('users_mv', {
      from: users,
      select: 'SELECT id FROM users',
    });

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [users],
        materializedViews: [usersMv],
      }),
    );

    expect(diffSnapshots(previousSnapshot, nextSnapshot).operations).toEqual([
      {
        kind: 'DropTable',
        tableName: 'events',
      },
      {
        kind: 'CreateTable',
        table: nextSnapshot.tables[0],
      },
      {
        kind: 'CreateMaterializedView',
        view: nextSnapshot.materializedViews[0],
      },
    ]);
  });

  it('wraps table mutations when dependent materialized views exist', () => {
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
      select: 'SELECT count() FROM orders',
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
              total: column.Decimal(12, 2).default('0'),
              status: column.String(),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['created_at', 'id'],
            },
          }),
        ],
        materializedViews: [ordersByDay],
      }),
    );

    const result = diffSnapshots(previousSnapshot, nextSnapshot);

    expect(result.operations).toEqual([
      {
        kind: 'AlterTableWithDependentViews',
        tableName: 'orders',
        dependentViewNames: ['orders_by_day'],
        operations: [
          {
            kind: 'AddColumn',
            tableName: 'orders',
            column: {
              name: 'status',
              type: 'String',
            },
          },
          {
            kind: 'ModifyColumnType',
            tableName: 'orders',
            columnName: 'total',
            previousType: 'Decimal(10, 2)',
            nextType: 'Decimal(12, 2)',
          },
          {
            kind: 'ModifyColumnDefault',
            tableName: 'orders',
            columnName: 'total',
            previousDefault: undefined,
            nextDefault: {
              kind: 'literal',
              value: '0',
            },
          },
        ],
      },
    ]);

    expect(result.warnings).toEqual([
      {
        kind: 'ModifyColumnTypeRequiresConfirmation',
        tableName: 'orders',
        columnName: 'total',
        message: 'Column type changed for "orders.total" from "Decimal(10, 2)" to "Decimal(12, 2)".',
      },
    ]);
  });

  it('reports unsupported engine changes and possible renames', () => {
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
            settings: {
              index_granularity: 8192,
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
            settings: {
              index_granularity: 4096,
            },
          }),
        ],
      }),
    );

    const result = diffSnapshots(previousSnapshot, nextSnapshot);

    expect(result.unsupportedChanges).toEqual([
      {
        kind: 'TableEngineChanged',
        tableName: 'users',
        message: 'Table engine changed for "users". Engine evolution is not auto-generated yet.',
      },
      {
        kind: 'TableSettingsChanged',
        tableName: 'users',
        message: 'Table settings changed for "users". Settings diffs are not auto-generated yet.',
      },
      {
        kind: 'PossibleColumnRename',
        tableName: 'users',
        columnName: 'email',
        message:
          'Possible column rename detected in "users": "email" -> "email_address". ' +
          'Rename inference is not supported in generated migrations.',
      },
    ]);

    expect(result.operations).toEqual([
      {
        kind: 'DropColumn',
        tableName: 'users',
        columnName: 'email',
      },
      {
        kind: 'AddColumn',
        tableName: 'users',
        column: {
          name: 'email_address',
          type: 'String',
        },
      },
    ]);
  });

  it('detects possible renames when structured defaults are equivalent', () => {
    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [
          defineTable('users', {
            columns: {
              id: column.UInt64(),
              email: column.String().default('unknown'),
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
              email_address: column.String().default('unknown'),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    expect(diffSnapshots(previousSnapshot, nextSnapshot).unsupportedChanges).toEqual([
      {
        kind: 'PossibleColumnRename',
        tableName: 'users',
        columnName: 'email',
        message:
          'Possible column rename detected in "users": "email" -> "email_address". ' +
          'Rename inference is not supported in generated migrations.',
      },
    ]);
  });

  it('recreates materialized views when their definition changes', () => {
    const events = defineTable('events', {
      columns: {
        id: column.UInt64(),
      },
      engine: {
        type: 'MergeTree',
        orderBy: ['id'],
      },
    });

    const previousSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [events],
        materializedViews: [
          defineMaterializedView('events_mv', {
            from: events,
            select: 'SELECT id FROM events',
          }),
        ],
      }),
    );

    const nextSnapshot = serializeSchemaToSnapshot(
      defineSchema({
        tables: [events],
        materializedViews: [
          defineMaterializedView('events_mv', {
            from: events,
            select: 'SELECT count() AS total FROM events',
          }),
        ],
      }),
    );

    expect(diffSnapshots(previousSnapshot, nextSnapshot).operations).toEqual([
      {
        kind: 'RecreateMaterializedView',
        previousView: previousSnapshot.materializedViews[0],
        nextView: nextSnapshot.materializedViews[0],
      },
    ]);
  });
});
