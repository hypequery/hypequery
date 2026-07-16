import { beforeEach, describe, expect, it, vi } from 'vitest';

const createRequireMock = vi.hoisted(() => vi.fn());

vi.mock('node:module', () => ({
  createRequire: createRequireMock,
}));

import {
  closeChdbSessionForTesting,
  ensureChdbInstalled,
  getChdbSession,
  getChdbTables,
  validateChdb,
} from './chdb-client.js';

describe('chdb client', () => {
  const sessions: FakeSession[] = [];

  class FakeSession {
    readonly close = vi.fn();
    readonly queryAsync = vi.fn(async (sql: string) => ({
      text: () => sql === 'SHOW TABLES'
        ? '{"name":"events"}\n{"name":"users"}\n'
        : '{"ok":1}\n',
    }));

    constructor(readonly dbPath?: string) {
      sessions.push(this);
    }
  }

  beforeEach(async () => {
    await closeChdbSessionForTesting();
    sessions.length = 0;
    vi.clearAllMocks();
    createRequireMock.mockReturnValue(() => ({ Session: FakeSession }));
  });

  it('resolves chdb from the project and reuses a session for the same path', async () => {
    await ensureChdbInstalled();
    const first = await getChdbSession('./analytics.chdb');
    const reused = await getChdbSession('./analytics.chdb');

    expect(createRequireMock).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
    );
    expect(reused).toBe(first);
    expect(sessions).toHaveLength(1);
  });

  it('closes the active session before switching paths', async () => {
    const first = await getChdbSession('./first.chdb') as FakeSession;
    const second = await getChdbSession('./second.chdb') as FakeSession;

    expect(first.close).toHaveBeenCalledOnce();
    expect(second).not.toBe(first);
    expect(sessions.map((item) => item.dbPath)).toEqual([
      './first.chdb',
      './second.chdb',
    ]);
  });

  it('validates the engine and parses table rows from JSONEachRow', async () => {
    await expect(validateChdb('./analytics.chdb')).resolves.toBe(true);
    await expect(getChdbTables('./analytics.chdb')).resolves.toEqual(['events', 'users']);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].queryAsync).toHaveBeenCalledWith(
      'SELECT 1 AS ok',
      { format: 'JSONEachRow' },
    );
    expect(sessions[0].queryAsync).toHaveBeenCalledWith(
      'SHOW TABLES',
      { format: 'JSONEachRow' },
    );
  });

  it('does not hide native module load failures', async () => {
    const loadError = new Error('native binding failed to load');
    createRequireMock.mockReturnValue(() => {
      throw loadError;
    });

    await expect(ensureChdbInstalled()).rejects.toBe(loadError);
  });

  it('provides an install hint when chdb cannot be resolved', async () => {
    const missingError = Object.assign(new Error('Cannot find module chdb'), {
      code: 'MODULE_NOT_FOUND',
    });
    createRequireMock.mockReturnValue(() => {
      throw missingError;
    });

    await expect(ensureChdbInstalled()).rejects.toThrow(
      'Install it with `npm install chdb`',
    );
  });
});
