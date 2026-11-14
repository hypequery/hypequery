import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { searchTitle } from './page-title';

describe('searchTitle', () => {
  it('keeps the brand template for short titles', () => {
    assert.equal(searchTitle('ClickHouse sumIf'), 'ClickHouse sumIf');
  });

  it('drops the brand suffix when it would push the title past 65 characters', () => {
    const long = 'ClickHouse Materialized Views: How They Work, With Examples';
    assert.deepEqual(searchTitle(long), { absolute: long });
  });

  it('measures against the suffix it is given', () => {
    const title = 'ClickHouse MCP quickstart: connect Claude and Cursor';
    assert.equal(searchTitle(title), title);
    assert.deepEqual(searchTitle(title, ' | hypequery docs'), { absolute: title });
  });
});
