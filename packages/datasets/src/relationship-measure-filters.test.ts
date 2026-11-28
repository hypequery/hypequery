/**
 * K-17: a base measure's fixed filter on a to-one relationship's field, e.g.
 * `count(comment_id) where response.is_test = false`. The filter names a
 * relationship the query itself never mentions, so selecting the measure must
 * plan the guarded single-match join on its own.
 */

import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { add } from './formulas.js';
import { eq } from './query-helpers.js';
import { belongsTo, hasMany } from './relationships.js';
import { validateDatasetQuery } from './dataset-query.js';
import { buildDatasetPlan, buildMetricPlan } from './semantic-planner.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import { buildProtocolDeploymentContract, rehydrateProtocolDeploymentContract, rehydrateProtocolDatasets } from './index.js';

const Projects = dataset('projects', {
  source: 'projects',
  tenantKey: 'org_id',
  dimensions: {
    id: dimension.string({ column: 'project_id' }),
    scoreType: dimension.string({ column: 'score_type' }),
  },
});

const Responses = dataset('responses', {
  source: 'responses',
  tenantKey: 'org_id',
  dimensions: {
    id: dimension.string({ column: 'response_id' }),
    projectId: dimension.string({ column: 'project_id' }),
    score: dimension.number(),
    isTest: dimension.boolean({ column: 'is_test' }),
    channel: dimension.string(),
  },
  measures: {
    responses: measure.count('id'),
    // `avg(score) where project.score_type = 'nps'`
    npsScore: measure.avg('score', { filters: [eq('project.scoreType', 'nps')] }),
  },
  relationships: {
    project: belongsTo(() => Projects, { from: 'project_id', to: 'project_id' }),
  },
});

const Comments = dataset('comments', {
  source: 'comments',
  tenantKey: 'org_id',
  timeKey: 'createdAt',
  dimensions: {
    id: dimension.string({ column: 'comment_id' }),
    responseId: dimension.string({ column: 'response_id' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
    sentiment: dimension.string(),
  },
  measures: {
    comments: measure.count('id'),
    // `count(comment_id) where response.is_test = false`
    realComments: measure.count('id', { filters: [eq('response.isTest', false)] }),
    realNegative: measure.count('id', {
      filters: [{ and: [eq('response.isTest', false), eq('sentiment', 'negative')] }],
    }),
    realCommenters: measure.countDistinct('id', { filters: [eq('response.isTest', false)] }),
    realShare: measure.derived({
      uses: { real: 'realComments', all: 'comments' },
      formula: ({ real, all }) => add(real, all),
    }),
    runningReal: measure.cumulative('realComments'),
  },
  relationships: {
    response: belongsTo(() => Responses, { from: 'response_id', to: 'response_id' }),
  },
});

const realCommentsMetric = Comments.metric('realCommentsMetric', { measure: 'realComments' });

const db = createQueryBuilder({ host: 'http://localhost:8123', database: 'default' });
const client = createDatasetClient({ queryBuilder: db });
const tenant = { runtime: { tenant: { id: 'org-1' } } };

const RESPONSE_JOIN =
  'LEFT ANY JOIN (SELECT `channel`, `is_test`, `org_id`, `project_id`, `response_id`, `score`, toNullable(1) AS `_hq_match` FROM `responses`) AS response ON comments.response_id = response.response_id';
const IS_TEST = 'if(isNotNull(response._hq_match), response.is_test, NULL)';

describe('measure filters through relationships (query-builder path)', () => {
  it('joins the relationship a selected measure filter reads', () => {
    const sql = client.toSQL(Comments, { measures: ['realComments'] }, tenant);
    expect(sql).toContain(RESPONSE_JOIN);
    // The join carries the target's own tenant scope.
    expect(sql).toMatch(/AS response ON comments\.response_id = response\.response_id AND response\.org_id = /);
    // The filter reads the guarded joined column, never a bare `response.is_test`.
    expect(sql).toContain(`COUNT(if((${IS_TEST} = 0), comments.comment_id, NULL)) AS \`realComments\``);
  });

  it('plans the same join as the equivalent query-level relationship filter', () => {
    const viaMeasure = client.toSQL(Comments, { measures: ['realComments'] }, tenant);
    const viaQuery = client.toSQL(Comments, {
      measures: ['comments'],
      filters: [{ field: 'response.isTest', operator: 'eq', value: false }],
    }, tenant);
    const join = (sql: string) => sql.slice(sql.indexOf('LEFT ANY JOIN'), sql.indexOf(' WHERE'));
    expect(join(viaMeasure)).toBe(join(viaQuery));
  });

  it('joins once for a relationship read by both a measure filter and a dimension', () => {
    const sql = client.toSQL(Comments, {
      dimensions: ['response.channel'],
      measures: ['realComments', 'realNegative'],
    }, tenant);
    expect(sql.match(/LEFT ANY JOIN/g)).toHaveLength(1);
  });

  it('joins for omitted measures, which select every base measure', () => {
    expect(client.toSQL(Comments, { dimensions: ['sentiment'] }, tenant)).toContain(RESPONSE_JOIN);
  });

  it('leaves a query that computes no relationship-filtered measure without a join', () => {
    const sql = client.toSQL(Comments, { dimensions: ['sentiment'], measures: ['comments'] }, tenant);
    expect(sql).toBe('SELECT comments.sentiment AS `sentiment`, COUNT(comments.comment_id) AS `comments` FROM comments WHERE comments.org_id = ? GROUP BY `sentiment`');
  });

  it('joins through derived and window measures over a filtered input', () => {
    expect(client.toSQL(Comments, { measures: ['realShare'] }, tenant)).toContain(RESPONSE_JOIN);
    const window = client.toSQL(Comments, {
      measures: ['runningReal'],
      by: 'day',
      filters: [{ field: 'createdAt', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] }],
    }, tenant);
    expect(window).toContain(RESPONSE_JOIN);
    expect(window).toContain(`if((${IS_TEST} = 0), comments.comment_id, NULL)`);
  });

  it('joins for a metric over a filtered measure', () => {
    expect(client.toSQL(realCommentsMetric, {}, tenant)).toContain(RESPONSE_JOIN);
  });

  it('applies the second example: avg(score) where project.score_type = nps', () => {
    const sql = client.toSQL(Responses, { measures: ['npsScore'] }, tenant);
    expect(sql).toContain('AS project ON responses.project_id = project.project_id');
    expect(sql).toContain("(if(isNotNull(project._hq_match), project.score_type, NULL) = 'nps')");
  });
});

describe('measure filter relationship validation', () => {
  const Answers = dataset('answers', {
    source: 'answers',
    dimensions: { id: dimension.string(), responseId: dimension.string({ column: 'response_id' }) },
  });
  const make = (field: string) => dataset('bad_comments', {
    source: 'bad_comments',
    dimensions: { id: dimension.string() },
    measures: { filtered: measure.count('id', { filters: [eq(field, 1)] }) },
    relationships: {
      response: belongsTo(() => Responses, { from: 'response_id', to: 'response_id' }),
      answers: hasMany(() => Answers, { from: 'id', to: 'response_id' }),
    },
  });

  it('refuses a multi-hop measure filter when the dataset is defined', () => {
    expect(() => make('response.project.scoreType')).toThrow(/not a declared dimension or a safe column identifier/);
  });

  it.each([
    ['answers.id', /hasMany \(to-many\) relationship and is not queryable/],
    ['response.missing', /Unknown dimension "missing" on relationship "response"/],
    ['nowhere.id', /Unknown relationship "nowhere"/],
  ])('refuses a measure filter on %s', (field, message) => {
    const bad = make(field);
    const result = validateDatasetQuery(bad, { measures: ['filtered'] });
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/Measure "filtered" filter on/);
    expect(result.errors.join('\n')).toMatch(message);
    expect(() => buildProtocolDatasetContract(bad as never)).toThrow(message);
  });

  it('requires runtime tenancy when a tenant-less dataset joins a tenant-scoped target', () => {
    const Loose = dataset('loose_comments', {
      source: 'loose_comments',
      dimensions: { id: dimension.string() },
      measures: { real: measure.count('id', { filters: [eq('response.isTest', false)] }) },
      relationships: { response: belongsTo(() => Responses, { from: 'response_id', to: 'response_id' }) },
    });
    const result = validateDatasetQuery(Loose, { measures: ['real'] });
    expect(result.errors).toContain(
      'Dataset "loose_comments" requires runtime tenant scoping because relationship "response" targets a tenant-scoped dataset.',
    );
  });

  it('refuses a relationship measure whose own filter would be a second hop', () => {
    const Threads = dataset('threads', {
      source: 'threads',
      dimensions: { id: dimension.string() },
      relationships: { comment: belongsTo(() => Comments, { from: 'comment_id', to: 'comment_id' }) },
    });
    const result = validateDatasetQuery(Threads, { measures: ['comment.realCommenters'] }, tenant);
    expect(result.errors.join('\n')).toMatch(/second hop/);
  });
});

describe('measure filters through relationships (semantic backend plan)', () => {
  const tables = {
    comments: [
      { comment_id: 'c1', response_id: 'r1', sentiment: 'negative', org_id: 'org-1' },
      { comment_id: 'c2', response_id: 'r1', sentiment: 'positive', org_id: 'org-1' },
      { comment_id: 'c3', response_id: 'r2', sentiment: 'negative', org_id: 'org-1' },
      { comment_id: 'c4', response_id: 'r-missing', sentiment: 'negative', org_id: 'org-1' },
    ],
    responses: [
      { response_id: 'r1', is_test: false, org_id: 'org-1' },
      { response_id: 'r2', is_test: true, org_id: 'org-1' },
    ],
  };

  it('plans the join a measure filter reads', () => {
    const plan = buildDatasetPlan(Comments, { measures: ['realComments'] }, tenant);
    expect(plan.kind === 'aggregate' && plan.joins).toEqual([
      expect.objectContaining({ relationship: 'response', source: 'responses', from: 'response_id', to: 'response_id' }),
    ]);
    expect(plan.kind === 'aggregate' && plan.aggregations[0]?.filters).toEqual([
      { field: 'response.is_test', operator: 'eq', value: false },
    ]);
  });

  it('plans the join for a metric over a filtered measure', () => {
    const plan = buildMetricPlan(realCommentsMetric, {}, tenant);
    expect(plan.kind === 'aggregate' && plan.joins?.map(join => join.relationship)).toEqual(['response']);
  });

  it('counts the same rows as the equivalent query-level relationship filter', async () => {
    const backend = createDatasetClient({ backend: createInMemoryBackend(tables) });
    const viaMeasure = await backend.execute(Comments, { measures: ['realComments'] }, tenant);
    const viaQuery = await backend.execute(Comments, {
      measures: ['comments'],
      filters: [{ field: 'response.isTest', operator: 'eq', value: false }],
    }, tenant);
    // c1 and c2 answer a real response; c3 a test one; c4 a missing one.
    expect(viaMeasure.data).toEqual([{ realComments: '2' }]);
    expect(viaQuery.data).toEqual([{ comments: '2' }]);
  });
});

describe('measure filters through relationships (deployment contract)', () => {
  const realComments = {
    kind: 'comparison',
    operator: 'eq',
    left: { kind: 'reference', name: 'response.isTest' },
    right: { kind: 'literal', value: false },
  };

  it('publishes the filter as a qualified reference and rebuilds to the same SQL (contract 3)', () => {
    const contract = buildProtocolDeploymentContract([Projects, Responses, Comments]);
    expect(contract.version).toBe(3);
    const comments = contract.datasets.find(item => item.name === 'comments');
    expect(comments?.measures.find(item => item.name === 'realComments')).toMatchObject({ filters: [realComments] });
    const rebuilt = rehydrateProtocolDeploymentContract(contract);
    const query = { dimensions: ['sentiment'], measures: ['realComments', 'realNegative', 'realShare'] };
    expect(client.toSQL(rebuilt.comments!, query, tenant)).toBe(client.toSQL(Comments, query, tenant));
  });

  it('publishes and rebuilds at contract 2', () => {
    const contracts = [Projects, Responses].map(item => buildProtocolDatasetContract(item));
    const rebuilt = rehydrateProtocolDatasets(contracts);
    const query = { measures: ['npsScore'] };
    expect(client.toSQL(rebuilt.responses!, query, tenant)).toBe(client.toSQL(Responses, query, tenant));
  });
});
