import { describe, expect, it } from 'vitest';

describe('example configurations', () => {
  it('loads the finite no-setup dataset config', async () => {
    const { datasets } = await import('../examples/system-one-config.js');

    expect(datasets.one).toMatchObject({
      name: 'one',
      source: 'system.one',
      limits: { maxResultSize: 1 },
    });
    expect(datasets.one.metrics).toHaveProperty('rowCount');
  });
});
