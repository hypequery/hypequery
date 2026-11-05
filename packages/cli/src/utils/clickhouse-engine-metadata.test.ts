import { describe, expect, it } from 'vitest';
import { parseEngineMetadata, sortingKeyColumns } from './clickhouse-engine-metadata.js';

// Cases kept in step with Cloud's engine-metadata tests.
describe('parseEngineMetadata', () => {
  it.each([
    ['MergeTree', 'MergeTree ORDER BY id', { family: 'MergeTree' }],
    ['ReplacingMergeTree', 'ReplacingMergeTree(ver) ORDER BY id', { family: 'ReplacingMergeTree', versionColumn: 'ver' }],
    [
      'ReplacingMergeTree',
      'ReplacingMergeTree(ver, is_deleted)',
      { family: 'ReplacingMergeTree', versionColumn: 'ver', deletedColumn: 'is_deleted' },
    ],
    ['ReplacingMergeTree', 'ReplacingMergeTree()', { family: 'ReplacingMergeTree' }],
    ['ReplacingMergeTree', 'ReplacingMergeTree ORDER BY id', { family: 'ReplacingMergeTree' }],
    [
      'ReplicatedReplacingMergeTree',
      "ReplicatedReplacingMergeTree('/path,(x)', '{replica}', `ver`, `is_deleted`) ORDER BY id",
      { family: 'ReplacingMergeTree', versionColumn: 'ver', deletedColumn: 'is_deleted' },
    ],
    [
      'SharedReplacingMergeTree',
      "SharedReplacingMergeTree('/clickhouse/{uuid}/{shard}', '{replica}', version, is_deleted)",
      { family: 'ReplacingMergeTree', versionColumn: 'version', deletedColumn: 'is_deleted' },
    ],
    ['SharedReplacingMergeTree', 'SharedReplacingMergeTree(version)', { family: 'ReplacingMergeTree', versionColumn: 'version' }],
    ['SharedMergeTree', "SharedMergeTree('/path', '{replica}') ORDER BY id", { family: 'MergeTree' }],
    ['CollapsingMergeTree', 'CollapsingMergeTree(sign)', { family: 'CollapsingMergeTree', signColumn: 'sign' }],
    [
      'SharedCollapsingMergeTree',
      "SharedCollapsingMergeTree('/path', 'replica', sign)",
      { family: 'CollapsingMergeTree', signColumn: 'sign' },
    ],
    [
      'VersionedCollapsingMergeTree',
      'VersionedCollapsingMergeTree(sign, version)',
      { family: 'VersionedCollapsingMergeTree', signColumn: 'sign', versionColumn: 'version' },
    ],
    [
      'SummingMergeTree',
      'SummingMergeTree((amount, tax)) ORDER BY id',
      { family: 'SummingMergeTree', summingColumns: ['amount', 'tax'] },
    ],
    ['SummingMergeTree', 'SummingMergeTree(amount)', { family: 'SummingMergeTree', summingColumns: ['amount'] }],
    ['SummingMergeTree', 'SummingMergeTree()', { family: 'SummingMergeTree' }],
    ['AggregatingMergeTree', 'AggregatingMergeTree()', { family: 'AggregatingMergeTree' }],
    ['SharedAggregatingMergeTree', "SharedAggregatingMergeTree('/path', 'replica')", { family: 'AggregatingMergeTree' }],
    ['Distributed', "Distributed('cluster', 'analytics', 'events_local', rand())", { family: 'Distributed' }],
    ['View', 'View', { family: 'View' }],
  ])('%s: %s', (engine, full, expected) => {
    expect(parseEngineMetadata(engine, full)).toEqual(expected);
  });

  it.each([
    'ReplacingMergeTree(ver',
    "ReplacingMergeTree('ver')",
    'ReplacingMergeTree(toUInt64(version))',
    'ReplacingMergeTree(date, (id), 8192, version)',
    'ReplacingMergeTree(ver, deleted, extra)',
    'ReplacingMergeTree(`ver` + 1)',
    'OtherEngine(ver)',
  ])('does not invent column semantics for malformed or legacy syntax: %s', (full) => {
    expect(parseEngineMetadata('ReplacingMergeTree', full)).toEqual({ family: 'ReplacingMergeTree' });
  });

  it('skips quoted replication paths including escapes', () => {
    expect(
      parseEngineMetadata('ReplicatedReplacingMergeTree', "ReplicatedReplacingMergeTree('/it\\'s,(x)', 'rep''lica', ver)"),
    ).toEqual({ family: 'ReplacingMergeTree', versionColumn: 'ver' });
  });
});

describe('sortingKeyColumns', () => {
  it.each([
    ['', []],
    ['id', ['id']],
    ['day, priority', ['day', 'priority']],
    ['tenant_id, toDate(created_at)', ['tenant_id', 'created_at']],
    ['`odd name`, id', ['odd name', 'id']],
    // Literals and function names are not columns.
    ["day, JSONExtractString(metadata, 'amount')", ['day', 'metadata']],
    ["tuple(region, 'it''s', 'a\\'b') ", ['region']],
    ['intHash32 (user_id)', ['user_id']],
  ])('%s', (key, expected) => {
    expect(sortingKeyColumns(key)).toEqual(expected);
  });
});
