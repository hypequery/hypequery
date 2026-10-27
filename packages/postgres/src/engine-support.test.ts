import { describe, expect, it } from 'vitest';
import { assertDatasetsSupported, belongsTo, dataset, datasetQueryBuilderErrors, dimension, measure } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from './index.js';
import { Orders } from './tests/fixtures.js';

const pg = createPostgresQueryBuilder();

describe('datasets the Postgres engine cannot run are refused up front', () => {
  it('accepts the full shared fixture, time measures and relationships included', () => {
    expect(datasetQueryBuilderErrors(Orders, pg)).toEqual([]);
  });

  it('reports final datasets, merge measures and raw SQL unsafe under Postgres lexing', () => {
    const Rollups = dataset('rollups', {
      source: 'analytics.rollups',
      final: true,
      dimensions: {
        // One literal to ClickHouse; under standard strings the DELETE is code.
        tag: dimension.string({ sql: "status || 'a\\'; DELETE FROM t; SELECT '", dependencies: ['status'] }),
      },
      measures: { users: measure.merge('uniq', 'users') },
    });
    expect(datasetQueryBuilderErrors(Rollups, pg)).toEqual([
      expect.stringMatching(/^Dataset "rollups": dimension "tag" sql/),
      'Dataset "rollups": final: true needs a row-version modifier (ClickHouse FINAL), which the postgres query builder does not have.',
      'Dataset "rollups": measure "users" uses merge, which the postgres query builder does not support.',
    ]);
    expect(() => assertDatasetsSupported([Orders, Rollups], pg)).toThrow(/cannot run on this query builder:\n- Dataset "rollups"/);
  });

  it('reports a relationship to a final dataset', () => {
    const Versions = dataset('versions', {
      source: 'analytics.versions', final: true,
      dimensions: { id: dimension.number() }, measures: { n: measure.count('id') },
    });
    const Events = dataset('events', {
      source: 'analytics.events',
      dimensions: { versionId: dimension.number({ column: 'version_id' }) },
      measures: { n: measure.count('versionId') },
      relationships: { version: belongsTo(() => Versions, { from: 'version_id', to: 'id' }) },
    });
    expect(datasetQueryBuilderErrors(Events, pg)).toEqual([
      'Dataset "events": relationship "version" joins final dataset "versions", which the postgres query builder cannot read with FINAL.',
    ]);
  });
});
