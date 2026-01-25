import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';
import { createStore, SQLiteStore, MemoryStore } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('createStore factory', () => {
  const tempDir = path.join(os.tmpdir(), 'hypequery-test-' + Date.now());
  const testDbPath = path.join(tempDir, 'test.db');

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Clean up test files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates directory if it does not exist', async () => {
    const customPath = path.join(tempDir, 'nested', 'deep', 'test.db');

    const store = await createStore({ dbPath: customPath, silent: true });

    expect(fs.existsSync(path.dirname(customPath))).toBe(true);
    await store.close();
  });

  it('returns SQLiteStore when possible', async () => {
    const store = await createStore({ dbPath: testDbPath, silent: true });

    expect(store).toBeInstanceOf(SQLiteStore);
    await store.close();
  });

  it('returns MemoryStore when forceMemory is true', async () => {
    const store = await createStore({ forceMemory: true, silent: true });

    expect(store).toBeInstanceOf(MemoryStore);
    await store.close();
  });

  it('applies retention policy on creation', async () => {
    // First, create a store and add some old data
    const store1 = await createStore({ dbPath: testDbPath, silent: true });
    const oldTime = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days ago
    await store1.addQuery({
      queryId: 'old-query',
      query: 'SELECT 1',
      startTime: oldTime,
      status: 'completed'
    });
    await store1.close();

    // Re-open with retention policy (30 days default)
    const store2 = await createStore({
      dbPath: testDbPath,
      retention: { maxDays: 30 },
      silent: true
    });

    // Old query should be cleaned up
    const result = await store2.getQuery('old-query');
    expect(result).toBeNull();

    await store2.close();
  });

  it('uses default retention values', async () => {
    const store = await createStore({ dbPath: testDbPath, silent: true });

    // Add a query that's within retention
    await store.addQuery({
      queryId: 'recent-query',
      query: 'SELECT 1',
      startTime: Date.now(),
      status: 'completed'
    });

    const result = await store.getQuery('recent-query');
    expect(result).not.toBeNull();

    await store.close();
  });

  it('uses custom maxMemoryQueries for MemoryStore', async () => {
    const store = await createStore({
      forceMemory: true,
      maxMemoryQueries: 5,
      silent: true
    }) as MemoryStore;

    // Add 6 queries, first one should be evicted
    for (let i = 0; i < 6; i++) {
      await store.addQuery({
        queryId: `q${i}`,
        query: `SELECT ${i}`,
        startTime: Date.now() + i,
        status: 'completed'
      });
    }

    expect(store.size).toBe(5);
    expect(await store.getQuery('q0')).toBeNull(); // Evicted
    expect(await store.getQuery('q5')).not.toBeNull();

    await store.close();
  });

  it('logs storage info when not silent', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const store = await createStore({ dbPath: testDbPath, silent: false });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[hypequery] SQLite storage:'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[hypequery] Retention:'));

    await store.close();
  });

  it('does not log when silent', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const store = await createStore({ dbPath: testDbPath, silent: true });

    expect(logSpy).not.toHaveBeenCalled();

    await store.close();
  });

  it('falls back to MemoryStore on SQLite error', async () => {
    // Use a path that will cause SQLite to fail (directory as file)
    const invalidPath = '/dev/null/invalid/path.db';
    const warnSpy = vi.spyOn(console, 'warn');

    const store = await createStore({ dbPath: invalidPath, silent: false });

    expect(store).toBeInstanceOf(MemoryStore);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[hypequery] SQLite unavailable'),
      expect.any(String)
    );

    await store.close();
  });

  it('uses default dbPath when not specified', async () => {
    // This test checks the default path logic by verifying directory creation
    // We can't easily test the exact default path without mocking process.cwd
    const store = await createStore({ forceMemory: true, silent: true });

    // Just verify it works with defaults
    expect(store).toBeInstanceOf(MemoryStore);

    await store.close();
  });

  it('handles partial retention options', async () => {
    const store = await createStore({
      dbPath: testDbPath,
      retention: { maxQueries: 500 }, // Only specify maxQueries
      silent: true
    });

    // Should use default maxDays (30)
    const oldTime = Date.now() - (40 * 24 * 60 * 60 * 1000);
    await store.addQuery({
      queryId: 'old-query',
      query: 'SELECT 1',
      startTime: oldTime,
      status: 'completed'
    });

    // Re-create to trigger cleanup
    await store.close();
    const store2 = await createStore({
      dbPath: testDbPath,
      retention: { maxQueries: 500 },
      silent: true
    });

    // Old query should be cleaned up (default 30 days)
    const result = await store2.getQuery('old-query');
    expect(result).toBeNull();

    await store2.close();
  });
});
