/**
 * K-17 against ClickHouse: a measure's fixed filter on a to-one relationship's
 * field returns the same numbers as the equivalent hand-written join.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import {
  belongsTo,
  buildProtocolDeploymentContract,
  createDatasetClient,
  dataset,
  dimension,
  eq,
  measure,
  rehydrateProtocolDeploymentContract,
} from '../../index.js';
import { toQueryBuilderFactory, type QueryBuilderFactoryLike, type QueryBuilderLike } from '../../query-builder-protocol.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const projectsTable = 'k17_projects';
const responsesTable = 'k17_responses';
const commentsTable = 'k17_comments';

const Projects = dataset('k17Projects', {
  source: projectsTable, tenantKey: 'org_id',
  dimensions: { id: dimension.string({ column: 'project_id' }), scoreType: dimension.string({ column: 'score_type' }) },
});
const Responses = dataset('k17Responses', {
  source: responsesTable, tenantKey: 'org_id',
  dimensions: {
    id: dimension.string({ column: 'response_id' }),
    score: dimension.number(),
    isTest: dimension.boolean({ column: 'is_test' }),
  },
  measures: {
    npsScore: measure.avg('score', { filters: [eq('project.scoreType', 'nps')] }),
  },
  relationships: { project: belongsTo(() => Projects, { from: 'project_id', to: 'project_id' }) },
});
const Comments = dataset('k17Comments', {
  source: commentsTable, tenantKey: 'org_id',
  dimensions: { id: dimension.string({ column: 'comment_id' }), sentiment: dimension.string() },
  measures: {
    comments: measure.count('id'),
    realComments: measure.count('id', { filters: [eq('response.isTest', false)] }),
  },
  relationships: { response: belongsTo(() => Responses, { from: 'response_id', to: 'response_id' }) },
});

const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host,
  username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password,
  database: TEST_CONNECTION_CONFIG.database,
});
const client = createDatasetClient({ queryBuilder: db });
/** The same client with the server-side join_use_nulls setting pinned on every query. */
const clientWithJoinNulls = (joinUseNulls: 0 | 1) => {
  const factory = toQueryBuilderFactory(db);
  return createDatasetClient({
    queryBuilder: {
      table: (name: string) => (factory.table(name) as unknown as ReturnType<typeof db.table>).settings({ join_use_nulls: joinUseNulls }) as unknown as QueryBuilderLike,
      rawQuery: factory.rawQuery.bind(factory),
    } satisfies QueryBuilderFactoryLike,
  });
};
const context = { runtime: { tenant: { id: 'a' } } };

describe('measure filters through relationships against ClickHouse (K-17)', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${projectsTable} (project_id String, score_type String, org_id String) ENGINE = MergeTree ORDER BY project_id`);
    await runSql(`CREATE TABLE ${responsesTable} (response_id String, project_id String, score Float64, is_test Bool, org_id String) ENGINE = MergeTree ORDER BY response_id`);
    await runSql(`CREATE TABLE ${commentsTable} (comment_id String, response_id String, sentiment String, org_id String) ENGINE = MergeTree ORDER BY comment_id`);
    await insertRows(projectsTable, [
      { project_id: 'p-nps', score_type: 'nps', org_id: 'a' },
      { project_id: 'p-csat', score_type: 'csat', org_id: 'a' },
      { project_id: 'p-other', score_type: 'nps', org_id: 'b' },
    ]);
    await insertRows(responsesTable, [
      { response_id: 'r1', project_id: 'p-nps', score: 9, is_test: false, org_id: 'a' },
      { response_id: 'r2', project_id: 'p-nps', score: 3, is_test: true, org_id: 'a' },
      { response_id: 'r3', project_id: 'p-csat', score: 4, is_test: false, org_id: 'a' },
      { response_id: 'r4', project_id: 'p-nps', score: 7, is_test: false, org_id: 'a' },
      // Another tenant's project: never joined for tenant a.
      { response_id: 'r5', project_id: 'p-other', score: 100, is_test: false, org_id: 'a' },
      // Another tenant's response.
      { response_id: 'r6', project_id: 'p-other', score: 0, is_test: false, org_id: 'b' },
    ]);
    await insertRows(commentsTable, [
      { comment_id: 'c1', response_id: 'r1', sentiment: 'negative', org_id: 'a' },
      { comment_id: 'c2', response_id: 'r1', sentiment: 'positive', org_id: 'a' },
      { comment_id: 'c3', response_id: 'r2', sentiment: 'negative', org_id: 'a' },
      { comment_id: 'c4', response_id: 'r3', sentiment: 'negative', org_id: 'a' },
      // Points at a missing response and at another tenant's response.
      { comment_id: 'c5', response_id: 'r-missing', sentiment: 'negative', org_id: 'a' },
      { comment_id: 'c6', response_id: 'r6', sentiment: 'positive', org_id: 'a' },
      { comment_id: 'c7', response_id: 'r1', sentiment: 'positive', org_id: 'b' },
    ]);
  });
  afterAll(async () => {
    for (const table of [commentsTable, responsesTable, projectsTable]) await runSql(`DROP TABLE IF EXISTS ${table}`);
  });

  const handWrittenComments = () => db.rawQuery(`
    SELECT c.sentiment AS sentiment, count(c.comment_id) AS real_comments
    FROM ${commentsTable} AS c
    INNER JOIN ${responsesTable} AS r ON c.response_id = r.response_id AND r.org_id = 'a'
    WHERE c.org_id = 'a' AND r.is_test = false
    GROUP BY sentiment ORDER BY sentiment`);

  it.each([0, 1] as const)('counts comments on real responses like the hand-written join (join_use_nulls=%s)', async (joinUseNulls) => {
    const expected = await handWrittenComments();
    expect(expected).toEqual([
      { sentiment: 'negative', real_comments: '2' },
      { sentiment: 'positive', real_comments: '1' },
    ]);
    const { data } = await clientWithJoinNulls(joinUseNulls).execute(Comments, {
      dimensions: ['sentiment'], measures: ['comments', 'realComments'], orderBy: [{ field: 'sentiment', direction: 'asc' }],
    }, context);
    expect(data).toEqual([
      { sentiment: 'negative', comments: '4', realComments: expected[0].real_comments },
      { sentiment: 'positive', comments: '2', realComments: expected[1].real_comments },
    ]);
  });

  it('totals the same as the query-level relationship filter', async () => {
    const viaMeasure = await client.execute(Comments, { measures: ['realComments'] }, context);
    const viaQuery = await client.execute(Comments, {
      measures: ['comments'], filters: [{ field: 'response.isTest', operator: 'eq', value: false }],
    }, context);
    expect(viaMeasure.data).toEqual([{ realComments: '3' }]);
    expect(viaQuery.data).toEqual([{ comments: '3' }]);
  });

  it('averages scores on NPS projects like the hand-written join', async () => {
    const expected = await db.rawQuery(`
      SELECT avg(r.score) AS nps
      FROM ${responsesTable} AS r
      INNER JOIN ${projectsTable} AS p ON r.project_id = p.project_id AND p.org_id = 'a'
      WHERE r.org_id = 'a' AND p.score_type = 'nps'`);
    expect(expected).toEqual([{ nps: 6.333333333333333 }]);
    const { data } = await client.execute(Responses, { measures: ['npsScore'] }, context);
    expect(Number(data[0].npsScore)).toBeCloseTo(Number(expected[0].nps), 10);
  });

  it('runs the same numbers from a rehydrated deployment contract', async () => {
    const rebuilt = rehydrateProtocolDeploymentContract(buildProtocolDeploymentContract([Projects, Responses, Comments]));
    const query = { dimensions: ['sentiment'], measures: ['realComments'], orderBy: [{ field: 'sentiment', direction: 'asc' as const }] };
    expect((await client.execute(rebuilt.k17Comments!, query, context)).data)
      .toEqual((await client.execute(Comments, query, context)).data);
  });
});
