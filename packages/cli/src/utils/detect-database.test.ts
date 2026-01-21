import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import {
  detectDatabase,
  validateConnection,
  getTableCount,
  getTables,
} from './detect-database.js';

vi.mock('node:fs/promises');

const mockQuery = vi.hoisted(() => vi.fn());
const mockGetClickHouseClient = vi.hoisted(() => vi.fn());

vi.mock('./clickhouse-client.js', () => ({
  getClickHouseClient: mockGetClickHouseClient,
}));

describe('detect-database', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClickHouseClient.mockReset();
    process.env = { ...originalEnv };
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_URL;
    delete process.env.CLICKHOUSE_DATABASE;
    delete process.env.CLICKHOUSE_USERNAME;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    delete process.env.CLICKHOUSE_PASS;
    delete process.env.BIGQUERY_PROJECT_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('detectDatabase', () => {
    it('detects clickhouse from env vars', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      await expect(detectDatabase()).resolves.toBe('clickhouse');
    });

    it('detects bigquery from env vars', async () => {
      process.env.BIGQUERY_PROJECT_ID = 'my-project';
      await expect(detectDatabase()).resolves.toBe('bigquery');
    });

    it('detects clickhouse from .env file', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('CLICKHOUSE_HOST=http://localhost:8123\n');

      await expect(detectDatabase()).resolves.toBe('clickhouse');
    });

    it('detects bigquery from .env file', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('BIGQUERY_PROJECT_ID=my-project\n');

      await expect(detectDatabase()).resolves.toBe('bigquery');
    });

    it('returns unknown when nothing matches', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      await expect(detectDatabase()).resolves.toBe('unknown');
    });
  });

  describe('validateConnection', () => {
    it('validates clickhouse connection', async () => {
      const mockResult = { json: vi.fn().mockResolvedValue([{ '1': 1 }]) };
      mockGetClickHouseClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      await expect(validateConnection('clickhouse')).resolves.toBe(true);
    });

    it('returns false when client throws', async () => {
      mockGetClickHouseClient.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      await expect(validateConnection('clickhouse')).resolves.toBe(false);
    });

    it('returns false for unsupported databases', async () => {
      await expect(validateConnection('bigquery')).resolves.toBe(false);
      await expect(validateConnection('unknown')).resolves.toBe(false);
    });
  });

  describe('getTableCount', () => {
    it('returns table count', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([
          { name: 'users' },
          { name: 'posts' },
        ]),
      };

      mockGetClickHouseClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      await expect(getTableCount('clickhouse')).resolves.toBe(2);
    });

    it('returns 0 when query fails', async () => {
      mockGetClickHouseClient.mockImplementation(() => {
        throw new Error('Query failed');
      });

      await expect(getTableCount('clickhouse')).resolves.toBe(0);
    });
  });

  describe('getTables', () => {
    it('returns table list', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([
          { name: 'users' },
          { name: 'posts' },
        ]),
      };

      mockGetClickHouseClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      await expect(getTables('clickhouse')).resolves.toEqual(['users', 'posts']);
    });

    it('returns empty list when query fails', async () => {
      mockGetClickHouseClient.mockImplementation(() => {
        throw new Error('Query failed');
      });

      await expect(getTables('clickhouse')).resolves.toEqual([]);
    });
  });
});
