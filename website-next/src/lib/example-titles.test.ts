import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exampleSearchTitle } from './example-titles';

test('short titles are unchanged', () => {
  assert.equal(exampleSearchTitle('ClickHouse to pandas'), 'ClickHouse to pandas');
});

test('long titles drop the typed-dataset tail, then cut at the colon', () => {
  assert.equal(
    exampleSearchTitle('Weekly retention cohorts in ClickHouse with a typed dataset and more words here'),
    'Weekly retention cohorts in ClickHouse with a typed dataset and more words here',
  );
  assert.equal(
    exampleSearchTitle('Upserts and deletes in ClickHouse with ReplacingMergeTree and a typed dataset'),
    'Upserts and deletes in ClickHouse with ReplacingMergeTree',
  );
  assert.equal(
    exampleSearchTitle('ClickHouse with Docker Compose: a pinned, persistent local server with a million-row sample dataset'),
    'ClickHouse with Docker Compose',
  );
});

test('a colon too early to leave a useful title is ignored', () => {
  const title = 'ISO: weeks in ClickHouse with toMonday buckets and labels across the year boundary';
  assert.equal(exampleSearchTitle(title), title);
});

test('a trailing "compared with" clause is dropped when the title is long', () => {
  assert.equal(
    exampleSearchTitle('Top N per group in ClickHouse with LIMIT BY, compared with row_number() and rank()'),
    'Top N per group in ClickHouse with LIMIT BY',
  );
});
