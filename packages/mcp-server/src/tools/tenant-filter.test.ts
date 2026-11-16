import { describe, expect, it } from 'vitest';
import {
  createDatasetClient,
  createInMemoryBackend,
  dataset,
  dimension,
  measure,
} from '@hypequery/datasets';
import { classifyMCPToolError } from '../errors.js';
import { HypequeryMCPExecutor } from '../executor.js';
import { TENANT_FIELD_NOT_FILTERABLE, tenantFieldFilterError } from './utils/tenant-filter.js';

const Events = dataset('events', {
  source: 'events',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    kind: dimension.string(),
  },
  measures: {
    events: measure.count('id'),
  },
});

const eventCount = Events.metric('eventCount', { measure: 'events' });

const rows = [
  { id: '1', tenant_id: 't-1', kind: 'view' },
  { id: '2', tenant_id: 't-1', kind: 'click' },
  { id: '3', tenant_id: 't-2', kind: 'view' },
  { id: '4', tenant_id: 't-2', kind: 'view' },
  { id: '5', tenant_id: 't-2', kind: 'click' },
];

const analytics = createDatasetClient({ backend: createInMemoryBackend({ events: rows }) });

function executor() {
  return new HypequeryMCPExecutor({
    datasets: { events: Object.assign(Events, { eventCount }) as any },
    analytics,
    tenantId: 't-1',
  });
}

function structured(result: { structuredContent?: Record<string, unknown> }) {
  return result.structuredContent as Record<string, any>;
}

const tenantFieldError = {
  code: 'MCP_INVALID_ARGUMENTS',
  category: 'correctable_input',
  message: 'Cannot filter on tenant field "tenantId": this caller\'s tenant is fixed by its credential.',
  retryable: false,
  correctable: true,
  relist: false,
  reason: TENANT_FIELD_NOT_FILTERABLE,
  hint: expect.stringContaining('Remove the filter on "tenantId"'),
};

describe('a tenant-scoped caller filtering on the tenant field', () => {
  it('is refused by datasets with an unclassified Error, which used to reach agents as a retryable failure', async () => {
    // Synchronous for a validation failure, so wrapped to catch it either way.
    const refusal = await Promise.resolve().then(() => analytics.execute(Events, {
      measures: ['events'],
      filters: [{ field: 'tenantId', operator: 'eq', value: 't-2' }],
    }, { runtime: { tenant: { id: 't-1' } } })).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain('Cannot filter on tenant field "tenantId"');
    // The old envelope: an internal failure the agent is told to retry.
    expect(classifyMCPToolError(refusal)).toMatchObject({
      code: 'MCP_EXECUTION_FAILED',
      retryable: true,
    });
    // The new one: a correctable argument that will never succeed as sent.
    expect(classifyMCPToolError(tenantFieldFilterError(refusal, 't-1'))).toEqual(tenantFieldError);
  });

  it('query_dataset returns a non-retryable input error with a hint', async () => {
    const result = await executor().callTool('query_dataset', {
      dataset: 'events',
      measures: ['events'],
      filters: [{ field: 'tenantId', operator: 'eq', value: 't-2' }],
    });

    expect(result.isError).toBe(true);
    expect(structured(result)).toEqual({ error: tenantFieldError });
    expect(result.content).toEqual([{
      type: 'text',
      text: `Error [MCP_INVALID_ARGUMENTS]: ${tenantFieldError.message}`,
    }]);
  });

  it('query_dataset reports the tenant field even beside an allowed filter', async () => {
    const result = await executor().callTool('query_dataset', {
      dataset: 'events',
      measures: ['events'],
      filters: [
        { field: 'kind', operator: 'eq', value: 'view' },
        { field: 'tenantId', operator: 'in', value: ['t-1', 't-2'] },
      ],
    });

    expect(structured(result)).toEqual({ error: tenantFieldError });
  });

  it('query_metric returns the same error', async () => {
    const result = await executor().callTool('query_metric', {
      dataset: 'events',
      metric: 'eventCount',
      filters: [{ field: 'tenantId', operator: 'eq', value: 't-2' }],
    });

    expect(structured(result)).toEqual({ error: tenantFieldError });
  });

  it('still answers a query grouped by the tenant field, scoped to the caller', async () => {
    const result = await executor().callTool('query_dataset', {
      dataset: 'events',
      dimensions: ['tenantId'],
      measures: ['events'],
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).data).toEqual([{ tenantId: 't-1', events: '2' }]);
  });

  it('still refuses tenant arguments as invalid arguments', async () => {
    const result = await executor().callTool('query_dataset', {
      dataset: 'events',
      measures: ['events'],
      tenant: 't-2',
      tenantId: 't-2',
    });

    expect(structured(result).error).toMatchObject({
      code: 'MCP_INVALID_ARGUMENTS',
      category: 'correctable_input',
      retryable: false,
      correctable: true,
    });
  });

  it('leaves other failures and unscoped callers alone', () => {
    const refusal = new Error('Invalid dataset query: Cannot filter on tenant field "tenantId" when runtime tenancy enforcement is active.');
    expect(tenantFieldFilterError(refusal, undefined)).toBeUndefined();
    expect(tenantFieldFilterError(new Error('Cannot filter on tenant field "x"'), 't-1')).toBeUndefined();
    expect(tenantFieldFilterError(new Error('Invalid dataset query: Unknown dimensions: x'), 't-1')).toBeUndefined();
    expect(tenantFieldFilterError('Invalid dataset query: Cannot filter on tenant field "x"', 't-1')).toBeUndefined();
  });
});
