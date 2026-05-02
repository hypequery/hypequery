import { describe, expect, it } from 'vitest';
import { buildPulledSchemaAst, renderPulledSchemaSource } from './index.js';

describe('pull schema introspection helpers', () => {
  it('builds a managed schema AST from introspected tables and columns', () => {
    const schema = buildPulledSchemaAst(
      [{
        name: 'events',
        engine: 'MergeTree',
        partitionKey: 'toYYYYMM(created_at)',
        sortingKey: 'tenant_id, created_at',
        primaryKey: 'tenant_id, created_at',
        samplingKey: '',
      }],
      [{
        table: 'events',
        name: 'created_at',
        type: "DateTime64(3, 'UTC')",
        defaultExpression: 'now64()',
        position: 1,
      }],
    );

    expect(schema.tables).toEqual([
      expect.objectContaining({
        name: 'events',
        columns: [
          expect.objectContaining({
            name: 'created_at',
            default: {
              kind: 'sql',
              value: 'now64()',
            },
          }),
        ],
      }),
    ]);
  });

  it('renders baseline schema source with materialized view follow-up comments', () => {
    const schema = buildPulledSchemaAst(
      [{
        name: 'events',
        engine: 'MergeTree',
        partitionKey: '',
        sortingKey: 'tenant_id',
        primaryKey: 'tenant_id',
        samplingKey: '',
      }],
      [{
        table: 'events',
        name: 'tenant_id',
        type: 'UInt64',
        position: 1,
      }],
    );

    const source = renderPulledSchemaSource(schema, {
      database: 'analytics',
      materializedViewCount: 2,
    });

    expect(source).toContain('export const schema = defineSchema');
    expect(source).toContain('Skipped 2 materialized views during baseline generation.');
  });
});
