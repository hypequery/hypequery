import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createQueryBuilder } from '../../query-builder.js';
import { ensureConnectionInitialized, initializeTestConnection, setupTestDatabase } from './setup.js';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

type CompositeJoinSchema = {
  composite_entities: { tenant_id: 'UInt32'; entity_id: 'UInt32'; sub_id: 'UInt32' };
  composite_children: {
    parent_tenant_id: 'UInt32'; parent_entity_id: 'UInt32'; parent_sub_id: 'UInt32'; child: 'String';
  };
};

(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('Composite joins - ClickHouse integration', () => {
  let db: ReturnType<typeof createQueryBuilder<CompositeJoinSchema>>;

  beforeAll(async () => {
    const connection = await initializeTestConnection();
    await setupTestDatabase();
    db = createQueryBuilder<CompositeJoinSchema>({ adapter: connection.adapter, dialect: connection.dialect });
    const client = ensureConnectionInitialized();
    await client.command({ query: `CREATE TABLE composite_entities (
      tenant_id UInt32, entity_id UInt32, sub_id UInt32
    ) ENGINE = Memory` });
    await client.command({ query: `CREATE TABLE composite_children (
      parent_tenant_id UInt32, parent_entity_id UInt32, parent_sub_id UInt32, child String
    ) ENGINE = Memory` });
    await client.command({ query: `INSERT INTO composite_entities VALUES (1, 7, 1), (2, 7, 1), (1, 7, 2), (1, 8, 1)` });
    await client.command({ query: `INSERT INTO composite_children VALUES
      (1, 7, 1, 'a'), (1, 7, 1, 'b'), (2, 7, 1, 'other tenant'), (1, 7, 2, 'other sub'), (3, 9, 1, 'orphan')` });
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    const client = ensureConnectionInitialized();
    await client.command({ query: 'DROP TABLE IF EXISTS composite_children' });
    await client.command({ query: 'DROP TABLE IF EXISTS composite_entities' });
  });

  test.each([
    ['innerJoin', 'INNER ALL', 4], ['leftJoin', 'LEFT ALL', 5],
    ['rightJoin', 'RIGHT ALL', 5], ['fullJoin', 'FULL ALL', 6],
  ] as const)('%s executes composite schema-table keys with an alias', async (method, sqlType, count) => {
    const base = db.table('composite_entities');
    const keys = [
      ['tenant_id', 'composite_children.parent_tenant_id'],
      ['entity_id', 'composite_children.parent_entity_id'],
      ['sub_id', 'composite_children.parent_sub_id'],
    ] as const;
    const query = {
      innerJoin: base.innerJoin('composite_children', keys, 'c'),
      leftJoin: base.leftJoin('composite_children', keys, 'c'),
      rightJoin: base.rightJoin('composite_children', keys, 'c'),
      fullJoin: base.fullJoin('composite_children', keys, 'c'),
    }[method]
      .select(['tenant_id', 'entity_id', 'sub_id', 'c.child as child'])
      .orderBy('tenant_id').orderBy('entity_id').orderBy('sub_id').orderBy('c.child')
      .settings({ join_use_nulls: 1, join_default_strictness: 'ALL' });
    const rows = await query.execute();
    const expected = await db.rawQuery(`
      SELECT tenant_id, entity_id, sub_id, c.child AS child
      FROM composite_entities ${sqlType} JOIN composite_children AS c
      ON tenant_id = c.parent_tenant_id AND entity_id = c.parent_entity_id AND sub_id = c.parent_sub_id
      ORDER BY tenant_id, entity_id, sub_id, c.child
      SETTINGS join_use_nulls = 1
    `);
    expect(rows).toEqual(expected);
    expect(rows).toHaveLength(count);
    const matched = rows.filter(row => row.tenant_id !== null && row.child !== null);
    expect(matched.map(row => [row.tenant_id, row.entity_id, row.sub_id, row.child])).toEqual([
      [1, 7, 1, 'a'], [1, 7, 1, 'b'], [1, 7, 2, 'other sub'], [2, 7, 1, 'other tenant'],
    ]);
  });

  test('LEFT ANY schema-table aliases match every key and keep at most one child', async () => {
    const rows = await db.table('composite_entities')
      .leftAnyJoin('composite_children', [
        ['tenant_id', 'composite_children.parent_tenant_id'],
        ['entity_id', 'composite_children.parent_entity_id'],
        ['sub_id', 'composite_children.parent_sub_id'],
      ], 'c')
      .select(['tenant_id', 'entity_id', 'sub_id', 'c.child as child'])
      .orderBy('tenant_id').orderBy('entity_id').orderBy('sub_id')
      .settings({ join_use_nulls: 1 }).execute();
    expect(rows).toHaveLength(4);
    expect(['a', 'b']).toContain(rows[0].child);
    expect(rows.slice(1).map(row => row.child)).toEqual(['other sub', null, 'other tenant']);
  });

  test.each(['leftJoin', 'leftAnyJoin'] as const)('%s preserves unmatched rows with a bound ON filter', async method => {
    const query = db.table('composite_entities')[method]('composite_children', [
      ['tenant_id', 'composite_children.parent_tenant_id'],
      ['entity_id', 'composite_children.parent_entity_id'],
      ['sub_id', 'composite_children.parent_sub_id'],
    ], 'c', { column: 'c.child', operator: 'eq', value: 'a' })
      .select(['tenant_id', 'entity_id', 'sub_id', 'c.child as child'])
      .orderBy('tenant_id').orderBy('entity_id').orderBy('sub_id')
      .settings({ join_use_nulls: 1 });
    expect(query.toSQLWithParams().parameters).toEqual(['a']);
    const rows = await query.execute();
    expect(rows).toHaveLength(4);
    expect(rows.map(row => row.child)).toEqual(['a', null, null, null]);
  });

  test('joins a three-component aggregate CTE without crossing tenant or sub keys', async () => {
    const entitiesSql = `
      SELECT toUInt32(1) AS tenant_id, toUInt32(7) AS entity_id, toUInt32(1) AS sub_id
      UNION ALL SELECT 2, 7, 1
      UNION ALL SELECT 1, 7, 2
      UNION ALL SELECT 1, 8, 1
    `;
    const childrenSql = `
      SELECT parent_tenant_id, parent_entity_id, parent_sub_id,
        toJSONString(arraySort(groupArray(child))) AS document
      FROM (
        SELECT toUInt32(1) AS parent_tenant_id, toUInt32(7) AS parent_entity_id,
          toUInt32(1) AS parent_sub_id, 'a' AS child
        UNION ALL SELECT 1, 7, 1, 'b'
        UNION ALL SELECT 2, 7, 1, 'other tenant'
        UNION ALL SELECT 1, 7, 2, 'other sub'
      )
      GROUP BY parent_tenant_id, parent_entity_id, parent_sub_id
    `;
    const query = db.withCTE('entities', entitiesSql, {
      tenant_id: 'UInt32', entity_id: 'UInt32', sub_id: 'UInt32',
    }).table('entities')
      .withCTE('children', childrenSql, {
        parent_tenant_id: 'UInt32', parent_entity_id: 'UInt32', parent_sub_id: 'UInt32', document: 'String',
      })
      .leftAnyJoin('children', [
        ['tenant_id', 'children.parent_tenant_id'],
        ['entity_id', 'children.parent_entity_id'],
        ['sub_id', 'children.parent_sub_id'],
      ])
      .select(['tenant_id', 'entity_id', 'sub_id', 'children.document as document'])
      .orderBy('tenant_id').orderBy('entity_id').orderBy('sub_id')
      .settings({ join_use_nulls: 1 });
    const result = await query.execute();
    const expected = await db.rawQuery(`
      WITH entities AS (${entitiesSql}), children AS (${childrenSql})
      SELECT tenant_id, entity_id, sub_id, children.document AS document
      FROM entities LEFT ANY JOIN children
        ON tenant_id = children.parent_tenant_id
        AND entity_id = children.parent_entity_id
        AND sub_id = children.parent_sub_id
      ORDER BY tenant_id, entity_id, sub_id
      SETTINGS join_use_nulls = 1
    `);
    expect(result).toEqual(expected);
    expect(result.map(row => row.document)).toEqual(['["a","b"]', '["other sub"]', null, '["other tenant"]']);
    expect(result).toHaveLength(4);
  });

  test('LEFT ANY composite joins take at most one duplicate full-key match', async () => {
    const query = db.withCTE('entity', 'SELECT toUInt32(1) AS tenant, toUInt32(7) AS entity', {
      tenant: 'UInt32', entity: 'UInt32',
    }).table('entity')
      .withCTE('matches', `
        SELECT toUInt32(1) AS parent_tenant, toUInt32(7) AS parent_entity, 'a' AS value
        UNION ALL SELECT 1, 7, 'b'
      `, { parent_tenant: 'UInt32', parent_entity: 'UInt32', value: 'String' })
      .leftAnyJoin('matches', [['tenant', 'matches.parent_tenant'], ['entity', 'matches.parent_entity']])
      .select(['matches.value']);
    const rows = await query.execute();
    expect(rows).toHaveLength(1);
    expect(['a', 'b']).toContain(rows[0].value);
  });

});
