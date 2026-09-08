import { dataset, dimension, measure } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { createMCPDiscoveryExecutor, HypequeryMCPDiscoveryExecutor } from './discovery-executor.js';
import { HypequeryMCPExecutor } from './executor.js';

const REVISION = 'a'.repeat(64);

/** Tenant-scoped, which is what the local executor refuses to list without a tenant. */
function datasets(): Record<string, unknown> {
  const Orders = dataset('orders', {
    source: 'analytics.orders',
    tenantKey: 'tenant_id',
    timeKey: 'createdAt',
    dimensions: {
      createdAt: dimension.timestamp({ column: 'created_at' }),
      status: dimension.string(),
      amount: dimension.number({ column: 'amount_cents', groupable: false }),
    },
    measures: { revenue: measure.sum('amount') },
  });
  return {
    orders: Object.assign(Orders, {
      metrics: { totalRevenue: Orders.metric('totalRevenue', { measure: 'revenue' }) },
    }),
  };
}

describe('HypequeryMCPDiscoveryExecutor', () => {
  it('lists a tenant-scoped catalog with no tenant and no query engine', async () => {
    // Both are what a gateway cannot supply: it resolves a tenant per request
    // through the data plane, and has no client of its own.
    const executor = createMCPDiscoveryExecutor({ datasets: datasets() });

    await expect(executor.listTools()).resolves.toMatchObject({
      tools: [
        { name: 'list_datasets' },
        { name: 'get_dataset_schema' },
        { name: 'query_metric' },
        { name: 'query_dataset' },
      ],
    });
    expect(executor.getManifestHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is the only executor that can, which is why it exists', () => {
    // Pins the gap rather than asserting it in a comment: the local executor
    // refuses this catalog outright, so a gateway cannot simply reuse it.
    expect(() => new HypequeryMCPExecutor({
      datasets: datasets() as never,
      analytics: {} as never,
    })).toThrow(/tenantId is required/);
  });

  it('compiles the same tool schemas as the executor that can run them', async () => {
    // `CORE-03` requires one catalog generator. If discovery drifted from
    // execution, an agent would be handed a schema its query is not checked
    // against.
    const discovery = createMCPDiscoveryExecutor({ datasets: datasets() });
    const full = new HypequeryMCPExecutor({
      datasets: datasets() as never, analytics: {} as never, tenantId: 'acme',
    });

    const { _meta: _discoveryMeta, ...listed } = await discovery.listTools();

    expect(listed).toEqual(await full.listTools());
    expect(discovery.getManifestHash()).toBe(full.getManifestHash());
  });

  it('answers catalog reads and refuses queries', async () => {
    const executor = createMCPDiscoveryExecutor({ datasets: datasets() });

    const listed = await executor.callTool('list_datasets');
    expect(JSON.parse(listed.content[0].type === 'text' ? listed.content[0].text : ''))
      .toMatchObject({ total: 1, datasets: [{ name: 'orders' }] });
    const schema = await executor.callTool('get_dataset_schema', { dataset: 'orders' });
    expect(schema.isError).toBeFalsy();
    expect(JSON.parse(schema.content[0].type === 'text' ? schema.content[0].text : ''))
      .toMatchObject({ name: 'orders', metrics: [{ name: 'totalRevenue' }] });
    await expect(executor.getPrompt('dataset_guide', { dataset: 'orders' }))
      .resolves.toMatchObject({ messages: [{ role: 'user' }] });

    for (const name of ['query_dataset', 'query_metric']) {
      const refused = await executor.callTool(name, { dataset: 'orders' });
      expect(refused.isError).toBe(true);
      // Listed but not runnable — not "unknown", which would tell a client to
      // stop asking once execution is wired in behind it.
      expect(refused.content[0].type === 'text' ? refused.content[0].text : '')
        .toContain('does not execute queries');
    }

    const unknown = await executor.callTool('nope');
    expect(unknown.content[0].type === 'text' ? unknown.content[0].text : '')
      .toContain('MCP_UNKNOWN_TOOL');
  });

  it('keeps a metric discoverable on a dataset it does not offer as a target', async () => {
    // A deployment authorizes a dataset and each of its metrics through
    // separate endpoint policies, so a caller can hold a metric on a dataset it
    // may not query. Collapsing the two would either advertise a target
    // execution refuses or hide a metric it would run.
    const executor = createMCPDiscoveryExecutor({
      datasets: datasets(),
      queryableDatasets: [],
    });

    const { tools } = await executor.listTools();
    const schema = (name: string) => JSON.stringify(
      tools.find(tool => tool.name === name)?.inputSchema,
    );

    // The metric is still offered, named against its dataset.
    expect(schema('query_metric')).toContain('totalRevenue');
    expect(schema('query_metric')).toContain('orders');
    // The dataset is not offered as a `query_dataset` target.
    expect(schema('query_dataset')).not.toContain('totalRevenue');
    expect(JSON.parse(schema('query_dataset')).properties.dataset)
      .not.toMatchObject({ enum: ['orders'] });
    // And it is still listed, or the metric would be undiscoverable.
    const listed = await executor.callTool('list_datasets');
    expect(JSON.parse(listed.content[0].type === 'text' ? listed.content[0].text : ''))
      .toMatchObject({ total: 1, datasets: [{ name: 'orders' }] });
  });

  it('offers every dataset as a target when none is withheld', async () => {
    const all = createMCPDiscoveryExecutor({ datasets: datasets() });
    const explicit = createMCPDiscoveryExecutor({
      datasets: datasets(), queryableDatasets: ['orders'],
    });

    // Naming every dataset is the same as naming none, so the option cannot
    // change a manifest it was not meant to narrow.
    expect(explicit.getManifestHash()).toBe(all.getManifestHash());
  });

  it('pins provenance a client can cache and invalidate on', async () => {
    const executor = new HypequeryMCPDiscoveryExecutor({
      datasets: datasets(),
      meta: {
        activationRevision: REVISION,
        deploymentIdentity: 'b'.repeat(64),
        toolMode: 'catalog',
      },
    });

    // Namespaced, as the MCP spec requires of implementation-defined `_meta`.
    await expect(executor.listTools()).resolves.toMatchObject({
      _meta: {
        'com.hypequery/activationRevision': REVISION,
        'com.hypequery/deploymentIdentity': 'b'.repeat(64),
        'com.hypequery/toolMode': 'catalog',
      },
    });
  });

  it('omits _meta rather than emitting empty keys', async () => {
    const bare = createMCPDiscoveryExecutor({ datasets: datasets() });
    const partial = createMCPDiscoveryExecutor({
      datasets: datasets(), meta: { toolMode: 'catalog' },
    });

    expect(await bare.listTools()).not.toHaveProperty('_meta');
    expect(await partial.listTools()).not.toHaveProperty('_meta.com.hypequery/activationRevision');
    expect((await partial.listTools())._meta)
      .toEqual({ 'com.hypequery/toolMode': 'catalog' });
  });

  it('advertises only the datasets it was given', async () => {
    // The narrowing a gateway applies for one principal happens before this,
    // on the contract. Whatever reaches here is what gets advertised.
    const executor = createMCPDiscoveryExecutor({ datasets: {} });

    const listed = await executor.callTool('list_datasets');

    expect(JSON.parse(listed.content[0].type === 'text' ? listed.content[0].text : ''))
      .toMatchObject({ total: 0 });
    expect(executor.getManifestHash())
      .not.toBe(createMCPDiscoveryExecutor({ datasets: datasets() }).getManifestHash());
  });
});
