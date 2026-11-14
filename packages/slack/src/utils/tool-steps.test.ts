import { describe, expect, it } from 'vitest';
import { answerFromToolResults, formatFilter, sourceFromInput } from './tool-steps.js';

describe('answerFromToolResults', () => {
  it('uses the last successful query result for the table and source', () => {
    const answer = answerFromToolResults({
      text: 'EU leads.',
      steps: [
        { toolResults: [{ toolName: 'list_datasets', input: {}, output: { datasets: [] } }] },
        { toolResults: [{ toolName: 'query_dataset', input: { dataset: 'orders' }, output: { data: [{ a: 1 }], meta: { rowCount: 1 } } }] },
        {
          toolResults: [
            {
              toolName: 'query_dataset',
              input: { dataset: 'orders', filters: [{ field: 'region', operator: 'in', value: ['EU', 'US'] }] },
              output: { data: [{ region: 'EU', revenue: 10 }], meta: { rowCount: 40 } },
            },
            { toolName: 'query_dataset', input: { dataset: 'x' }, output: { error: { code: 'MCP_NOT_FOUND' } } },
          ],
        },
      ],
    });
    expect(answer).toEqual({
      title: undefined,
      text: 'EU leads.',
      link: undefined,
      table: { rows: [{ region: 'EU', revenue: 10 }], totalRows: 40 },
      source: { dataset: 'orders', filters: ['region in EU, US'] },
    });
  });

  it('returns text only when no query succeeded', () => {
    expect(answerFromToolResults({ text: 'No data.', steps: [] })).toEqual({ title: undefined, text: 'No data.', link: undefined });
  });
});

describe('formatFilter / sourceFromInput', () => {
  it('formats operators', () => {
    expect(formatFilter({ field: 'amount', operator: 'gte', value: 10 })).toBe('amount ≥ 10');
    expect(formatFilter({ field: 'day', operator: 'between', value: ['2026-11-01', '2026-11-07'] })).toBe(
      'day between 2026-11-01 and 2026-11-07',
    );
    expect(formatFilter({ field: 'email', operator: 'isNull' })).toBe('email is empty');
    expect(formatFilter('nope')).toBeNull();
  });
  it('reads metric inputs and ignores junk', () => {
    expect(sourceFromInput({ metric: 'mrr' })).toEqual({ dataset: 'mrr' });
    expect(sourceFromInput(null)).toBeUndefined();
  });
});
