import { describe, expect, it } from 'vitest';
import { formatRegenerateDatasetsCommand } from './regenerate-datasets-command.js';

describe('formatRegenerateDatasetsCommand', () => {
  it('omits the tenant column when the scaffold has no tenant runtime', () => {
    expect(formatRegenerateDatasetsCommand({ outputDir: 'analytics', auth: 'none' })).toBe(
      'hypequery generate:datasets --path analytics',
    );
  });

  it('repeats the context-auth tenant column so regeneration keeps tenantKey', () => {
    expect(
      formatRegenerateDatasetsCommand({
        outputDir: 'analytics',
        auth: 'context',
        tables: 'orders,users',
      }),
    ).toBe(
      'hypequery generate:datasets --path analytics --tables orders,users --tenant-column tenant_id',
    );
  });
});
