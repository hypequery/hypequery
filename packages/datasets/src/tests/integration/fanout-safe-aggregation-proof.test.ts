import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';
import { FANOUT_PROOF_TABLES, fanoutProofSql } from '../support/utils/fanout-proof-sql.js';

interface ParentRow { tenant: string; id: number; amount: number; status: string }
interface ChildRow { tenant: string; id: number; parent_id: number | null; category: string | null; amount: number }
interface SiblingRow { tenant: string; id: number; parent_id: number; amount: number }
interface ProofResult {
  category?: string | null;
  parent_sum: number | null;
  parent_count: number;
  parent_avg: number | null;
  child_sum: number | null;
  child_count: number;
  sibling_sum?: number | null;
}
const fixture = JSON.parse(readFileSync(new URL(
  '../../../../../specs/security-protocol/drafts/fanout-safe-aggregation-v1/rows.json', import.meta.url,
), 'utf8')) as {
  parents: ParentRow[]; children: ChildRow[]; siblings: SiblingRow[];
  expected: { total: ProofResult; groups: Omit<ProofResult, 'parent_avg'>[] };
};
const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database,
});
const { parents, children, siblings } = FANOUT_PROOF_TABLES;

describe('HQ-81 proposed owner-population SQL (not public planner support)', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${parents} (tenant String, id UInt64, amount Float64, status String) ENGINE = MergeTree ORDER BY (tenant, id)`);
    await runSql(`CREATE TABLE ${children} (tenant String, id UInt64, parent_id Nullable(UInt64), category Nullable(String), amount Float64) ENGINE = MergeTree ORDER BY (tenant, id)`);
    await runSql(`CREATE TABLE ${siblings} (tenant String, id UInt64, parent_id UInt64, amount Float64) ENGINE = MergeTree ORDER BY (tenant, id)`);
    await insertRows(parents, fixture.parents.map(row => ({ ...row })));
    await insertRows(children, fixture.children.map(row => ({ ...row })));
    await insertRows(siblings, fixture.siblings.map(row => ({ ...row })));
  });
  afterAll(async () => {
    for (const table of Object.values(FANOUT_PROOF_TABLES)) await runSql(`DROP TABLE IF EXISTS ${table}`);
  });

  it.each([0, 1] as const)('matches independent owner totals with join_use_nulls=%s', async joinUseNulls => {
    const actual = await db.rawQuery<ProofResult>(fanoutProofSql({ joinUseNulls }));
    expect(actual).toEqual([fixture.expected.total]);
    const [parentTruth] = await db.rawQuery<{ total: number; rows: number; average: number }>(
      `SELECT sum(amount) AS total, count() AS rows, avg(amount) AS average FROM ${parents} WHERE tenant = 'a' SETTINGS output_format_json_quote_64bit_integers = 0`,
    );
    const [childTruth] = await db.rawQuery<{ total: number; rows: number }>(
      `SELECT sum(amount) AS total, count() AS rows FROM ${children}
       WHERE tenant = 'a' AND parent_id IN (SELECT id FROM ${parents} WHERE tenant = 'a') SETTINGS output_format_json_quote_64bit_integers = 0`,
    );
    expect(actual[0].parent_sum).toBe(parentTruth.total);
    expect(actual[0].parent_count).toBe(parentTruth.rows);
    expect(actual[0].parent_avg).toBe(parentTruth.average);
    expect(actual[0].child_sum).toBe(childTruth.total);
    expect(actual[0].child_count).toBe(childTruth.rows);
  });

  it.each([0, 1] as const)('counts each owner once per category including NULL with join_use_nulls=%s', async joinUseNulls => {
    const actual = await db.rawQuery<ProofResult>(fanoutProofSql({ grouped: true, joinUseNulls }));
    expect(actual.map(({ parent_avg: _average, ...row }) => row)
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''))).toEqual(fixture.expected.groups);
    expect(actual.reduce((sum, row) => sum + (row.parent_sum ?? 0), 0)).toBe(160);
    expect(fixture.expected.total.parent_sum).toBe(140);
  });

  it('proves plain JOIN and SUM(DISTINCT value) cannot implement the contract', async () => {
    const [wrong] = await db.rawQuery<{ inflated: number; collapsed: number }>(
      `SELECT sum(p.amount) AS inflated, sum(DISTINCT p.amount) AS collapsed
       FROM ${parents} AS p LEFT ALL JOIN ${children} AS c ON p.tenant = c.tenant AND p.id = c.parent_id
       WHERE p.tenant = 'a' SETTINGS output_format_json_quote_64bit_integers = 0`,
    );
    expect(wrong.inflated).toBe(170);
    expect(wrong.collapsed).toBe(130);
    expect(wrong.inflated).not.toBe(fixture.expected.total.parent_sum);
    expect(wrong.collapsed).not.toBe(fixture.expected.total.parent_sum);
  });

  it('applies child query filters to membership without repeating parent values', async () => {
    const actual = await db.rawQuery<ProofResult>(fanoutProofSql({ childFilter: true }));
    expect(actual).toEqual([{ parent_sum: 20, parent_count: 2, parent_avg: 10, child_sum: 7, child_count: 3 }]);
  });

  it('keeps fixed child-measure filters out of the parent population', async () => {
    const actual = await db.rawQuery<ProofResult>(fanoutProofSql({ fixedChildFilter: true }));
    expect(actual).toEqual([{ ...fixture.expected.total, child_sum: 7, child_count: 3 }]);
  });

  it('preserves groups with no child measure inputs and returns NULL sum / zero count', async () => {
    const actual = await db.rawQuery<ProofResult>(fanoutProofSql({ grouped: true, fixedChildFilter: true }));
    expect(actual.filter(row => row.category !== 'red').map(row => [row.child_sum, row.child_count]))
      .toEqual([[null, 0], [null, 0]]);
  });

  it('can extend owner populations to sibling Cartesian fan-out without double counting', async () => {
    const actual = await db.rawQuery<ProofResult>(fanoutProofSql({ siblings: true }));
    expect(actual).toEqual([{ ...fixture.expected.total, sibling_sum: 10 }]);
  });

  it('keeps tenant ID collisions distinct when several tenants are selected', async () => {
    const [actual] = await db.rawQuery<ProofResult>(fanoutProofSql({ allTenants: true }));
    expect(actual.parent_sum).toBe(1139);
    expect(actual.parent_count).toBe(6);
    expect(actual.child_sum).toBe(1042);
    expect(actual.child_count).toBe(8);
  });

  it('returns scalar zero counts / NULL values for empty ungrouped populations', async () => {
    expect(await db.rawQuery<ProofResult>(fanoutProofSql({ empty: true }))).toEqual([{
      parent_sum: null, parent_count: 0, parent_avg: null, child_sum: null, child_count: 0,
    }]);
    expect(await db.rawQuery<ProofResult>(fanoutProofSql({ empty: true, grouped: true }))).toEqual([]);
  });

  it('detects duplicate and NULL primary keys instead of treating ORDER BY as uniqueness', async () => {
    const [diagnostic] = await db.rawQuery<{ rows: number; keys: number; nulls: number }>(
      `SELECT count() AS rows, uniqExact(tuple(tenant, id)) AS keys, countIf(isNull(id)) AS nulls
       FROM (
         SELECT tenant, toNullable(id) AS id FROM ${parents} WHERE tenant = 'a'
         UNION ALL SELECT 'a' AS tenant, toNullable(toUInt64(1)) AS id
         UNION ALL SELECT 'a' AS tenant, CAST(NULL AS Nullable(UInt64)) AS id
       ) SETTINGS output_format_json_quote_64bit_integers = 0`,
    );
    expect(diagnostic).toEqual({ rows: 7, keys: 6, nulls: 1 });
  });
});
