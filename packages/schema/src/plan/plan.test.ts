import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../diff/index.js';
import { column, defineSchema, defineTable } from '../schema/index.js';
import { serializeSchemaToSnapshot } from '../snapshot/index.js';
import { createMigrationPlan, isMigrationPlan } from './index.js';

describe('create migration plan', () => {
  it('classifies metadata operations', () => {
    const previousSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const nextSnapshot = serializeSchemaToSnapshot(
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

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot));

    expect(isMigrationPlan(plan)).toBe(true);
    expect(plan.operations).toEqual([
      expect.objectContaining({
        classification: 'metadata',
        operation: expect.objectContaining({ kind: 'CreateTable' }),
      }),
    ]);
    expect(plan.blockers).toEqual([]);
    expect(plan.requiredConfirmations).toEqual([]);
    expect(plan.requiredSyncSettings).toEqual([]);
  });

  it('classifies type changes as mutations that require confirmation', () => {
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
              id: column.UInt64(),
              payload: column.Nullable('String'),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot));

    expect(plan.operations).toEqual([
      expect.objectContaining({
        classification: 'mutation',
        costEstimate: expect.objectContaining({
          confidence: 'none',
          source: 'static',
          tableName: 'events',
        }),
        operation: expect.objectContaining({ kind: 'ModifyColumnType' }),
      }),
    ]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          kind: 'ModifyColumnTypeRequiresConfirmation',
        }),
        expect.objectContaining({
          level: 'warning',
          kind: 'MutationOperation',
        }),
      ]),
    );
    expect(plan.requiredConfirmations).toEqual([
      expect.objectContaining({
        kind: 'MutationRequiresConfirmation',
        operationIndex: 0,
      }),
    ]);
    expect(plan.recommendedSyncSettings).toEqual([
      expect.objectContaining({ name: 'alter_sync', value: 2 }),
      expect.objectContaining({ name: 'mutations_sync', value: 2 }),
    ]);
    expect(plan.requiredSyncSettings).toEqual([
      expect.objectContaining({ name: 'alter_sync', value: 2 }),
      expect.objectContaining({ name: 'mutations_sync', value: 2 }),
    ]);
  });

  it('turns unsupported changes into blockers', () => {
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
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot));

    expect(plan.blockers).toEqual([
      expect.objectContaining({
        kind: 'PossibleColumnRename',
        tableName: 'users',
        columnName: 'email',
      }),
    ]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          kind: 'PossibleColumnRename',
        }),
      ]),
    );
  });

  it('classifies key-column drops as forbidden blockers', () => {
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

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot));

    expect(plan.operations).toEqual([
      expect.objectContaining({
        classification: 'forbidden',
        operation: expect.objectContaining({ kind: 'DropColumn', columnName: 'id' }),
      }),
    ]);
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        kind: 'ForbiddenOperation',
        operationIndex: 0,
      }),
    ]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          kind: 'ForbiddenOperation',
          operationIndex: 0,
          message: expect.stringContaining('Recommended approach'),
        }),
      ]),
    );
  });

  it('runs custom analyzers against the generated plan', () => {
    const previousSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const nextSnapshot = serializeSchemaToSnapshot(
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

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot), {
      context: {
        tables: {
          events: {
            tableName: 'events',
            totalRows: 10,
          },
        },
      },
      analyzers: [
        (plan, context) => ({
          diagnostics: [{
            level: 'warning',
            kind: 'CustomAnalyzer',
            message:
              `planned ${plan.operations.length} operation(s) from ${context.diff.previousSnapshot.contentHash} ` +
              `with ${context.clickhouse?.tables ? 'context' : 'no context'}`,
          }],
          blockers: [{
            kind: 'CustomBlocker',
            message: 'custom analyzer blocked this plan',
          }],
          confirmations: [{
            kind: 'CustomConfirmation',
            operationIndex: 0,
            message: 'custom analyzer requires confirmation',
          }],
        }),
      ],
    });

    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          kind: 'CustomAnalyzer',
        }),
      ]),
    );
    expect(plan.blockers).toEqual([
      expect.objectContaining({ kind: 'CustomBlocker' }),
    ]);
    expect(plan.requiredConfirmations).toEqual([
      expect.objectContaining({ kind: 'CustomConfirmation' }),
    ]);
  });

  it('converts analyzer failures into diagnostics and blockers', () => {
    const previousSnapshot = serializeSchemaToSnapshot(defineSchema({ tables: [] }));
    const nextSnapshot = serializeSchemaToSnapshot(
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

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot), {
      analyzers: [
        () => {
          throw new Error('boom');
        },
      ],
    });

    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          kind: 'AnalyzerError',
          message: expect.stringContaining('boom'),
        }),
      ]),
    );
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        kind: 'AnalyzerError',
        message: expect.stringContaining('boom'),
      }),
    ]);
  });

  it('attaches provided cost estimates and emits threshold diagnostics', () => {
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
              id: column.UInt64(),
              payload: column.Nullable('String'),
            },
            engine: {
              type: 'MergeTree',
              orderBy: ['id'],
            },
          }),
        ],
      }),
    );

    const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot), {
      context: {
        mutationWarningBytes: -100,
        mutationWarningRows: 0,
        activePartsWarningThreshold: -10,
        replicaDelayWarningSeconds: 10,
        tables: [{
          tableName: 'events',
          totalRows: 1_000,
          totalBytes: 2_000,
          activeParts: 25,
          pendingMutations: 2,
          replicaAbsoluteDelaySeconds: 30,
          replicaQueueSize: 5,
        }],
      },
    });

    expect(plan.operations[0]).toEqual(
      expect.objectContaining({
        costEstimate: {
          tableName: 'events',
          affectedRows: 1_000,
          affectedBytes: 2_000,
          activeParts: 25,
          pendingMutations: 2,
          replicaAbsoluteDelaySeconds: 30,
          replicaQueueSize: 5,
          source: 'provided-context',
          confidence: 'medium',
        },
      }),
    );
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ExpensiveMutationBytes' }),
        expect.objectContaining({ kind: 'ExpensiveMutationRows' }),
        expect.objectContaining({ kind: 'HighActivePartCount' }),
        expect.objectContaining({ kind: 'PendingMutations' }),
        expect.objectContaining({ kind: 'ReplicaDelay' }),
      ]),
    );
  });
});
