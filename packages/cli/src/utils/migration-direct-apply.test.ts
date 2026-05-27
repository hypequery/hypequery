import { describe, expect, it, vi } from 'vitest';
import { applyMigrationSqlDirectly } from './migration-direct-apply.js';

describe('migration direct apply', () => {
  it('applies split SQL statements in order', async () => {
    const client = {
      command: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyMigrationSqlDirectly(client, [
      'SELECT 1;',
      '-- hypequery:breakpoint',
      'SELECT 2;',
    ].join('\n'))).resolves.toEqual({
      appliedStepCount: 2,
      totalSteps: 2,
    });

    expect(client.command).toHaveBeenNthCalledWith(1, { query: 'SELECT 1;' });
    expect(client.command).toHaveBeenNthCalledWith(2, { query: 'SELECT 2;' });
  });

  it('reports the failing statement index', async () => {
    const client = {
      command: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('boom')),
    };

    await expect(applyMigrationSqlDirectly(client, 'SELECT 1;\nSELECT 2;'))
      .rejects
      .toThrow('Push failed at statement 2/2');
  });

  it('rejects empty SQL', async () => {
    const client = {
      command: vi.fn().mockResolvedValue(undefined),
    };

    await expect(applyMigrationSqlDirectly(client, '-- comment only\n'))
      .rejects
      .toThrow('no executable SQL');
    expect(client.command).not.toHaveBeenCalled();
  });
});
