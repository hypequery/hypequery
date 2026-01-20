import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import {
  detectDatabase,
  validateConnection,
  getTableCount,
  getTables,
} from './detect-database.js';

vi.mock('node:fs/promises');

// Mock the ClickHouse module
const mockQuery = vi.fn();
const mockGetClient = vi.fn();
const mockInitialize = vi.fn();

vi.mock('@hypequery/clickhouse', () => ({
  ClickHouseConnection: {
    getClient: mockGetClient,
    initialize: mockInitialize,
  },
}));

describe('detect-database', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Clear all ClickHouse env vars
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
    it('should detect clickhouse from CLICKHOUSE_HOST env var', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';

      const result = await detectDatabase();

      expect(result).toBe('clickhouse');
    });

    it('should detect clickhouse from CLICKHOUSE_URL env var', async () => {
      process.env.CLICKHOUSE_URL = 'http://localhost:8123';

      const result = await detectDatabase();

      expect(result).toBe('clickhouse');
    });

    it('should detect clickhouse from CLICKHOUSE_DATABASE env var', async () => {
      process.env.CLICKHOUSE_DATABASE = 'analytics';

      const result = await detectDatabase();

      expect(result).toBe('clickhouse');
    });

    it('should detect bigquery from BIGQUERY_PROJECT_ID env var', async () => {
      process.env.BIGQUERY_PROJECT_ID = 'my-project';

      const result = await detectDatabase();

      expect(result).toBe('bigquery');
    });

    it('should detect bigquery from GOOGLE_APPLICATION_CREDENTIALS env var', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/credentials.json';

      const result = await detectDatabase();

      expect(result).toBe('bigquery');
    });

    it('should detect clickhouse from .env file', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('CLICKHOUSE_HOST=http://localhost:8123\n');

      const result = await detectDatabase();

      expect(result).toBe('clickhouse');
    });

    it('should detect clickhouse from CLICKHOUSE_ prefix in .env', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('CLICKHOUSE_DATABASE=default\n');

      const result = await detectDatabase();

      expect(result).toBe('clickhouse');
    });

    it('should detect bigquery from .env file', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('BIGQUERY_PROJECT_ID=my-project\n');

      const result = await detectDatabase();

      expect(result).toBe('bigquery');
    });

    it('should detect bigquery from BIGQUERY_ prefix in .env', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('BIGQUERY_DATASET=analytics\n');

      const result = await detectDatabase();

      expect(result).toBe('bigquery');
    });

    it('should return unknown if no database detected from env', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await detectDatabase();

      expect(result).toBe('unknown');
    });

    it('should return unknown if .env does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await detectDatabase();

      expect(result).toBe('unknown');
    });

    it('should return unknown if .env has no database vars', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('NODE_ENV=development\nPORT=3000\n');

      const result = await detectDatabase();

      expect(result).toBe('unknown');
    });

    it('should prefer env vars over .env file', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('BIGQUERY_PROJECT_ID=my-project\n');

      const result = await detectDatabase();

      // Should return clickhouse because env vars are checked first
      expect(result).toBe('clickhouse');
      // Should not even try to read .env
      expect(access).not.toHaveBeenCalled();
    });
  });

  describe('validateConnection', () => {
    it('should validate clickhouse connection successfully', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ '1': 1 }]),
      };

      mockGetClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await validateConnection('clickhouse');

      expect(result).toBe(true);
    });

    it('should return false for failed clickhouse connection', async () => {
      mockGetClient.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      const result = await validateConnection('clickhouse');

      expect(result).toBe(false);
    });

    it('should initialize connection if not already initialized', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      process.env.CLICKHOUSE_DATABASE = 'default';

      const mockResult = {
        json: vi.fn().mockResolvedValue([{ '1': 1 }]),
      };

      mockGetClient
        .mockImplementationOnce(() => {
          const error = new Error('ClickHouse connection not initialized');
          throw error;
        })
        .mockReturnValueOnce({
          query: vi.fn().mockResolvedValue(mockResult),
        });

      const result = await validateConnection('clickhouse');

      expect(mockInitialize).toHaveBeenCalledWith({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: '',
      });
      expect(result).toBe(true);
    });

    it('should return false for bigquery (not implemented)', async () => {
      const result = await validateConnection('bigquery');

      expect(result).toBe(false);
    });

    it('should return false for unknown database', async () => {
      const result = await validateConnection('unknown');

      expect(result).toBe(false);
    });
  });

  describe('getTableCount', () => {
    it('should return table count for clickhouse', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([
          { name: 'users' },
          { name: 'posts' },
          { name: 'comments' },
        ]),
      };

      mockGetClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await getTableCount('clickhouse');

      expect(result).toBe(3);
    });

    it('should return 0 if query fails', async () => {
      mockGetClient.mockImplementation(() => {
        throw new Error('Query failed');
      });

      const result = await getTableCount('clickhouse');

      expect(result).toBe(0);
    });

    it('should return 0 for unknown database', async () => {
      const result = await getTableCount('unknown');

      expect(result).toBe(0);
    });

    it('should handle non-array response', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue({ invalid: 'response' }),
      };

      mockGetClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await getTableCount('clickhouse');

      expect(result).toBe(0);
    });
  });

  describe('getTables', () => {
    it('should return list of tables for clickhouse', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([
          { name: 'users' },
          { name: 'posts' },
          { name: 'comments' },
        ]),
      };

      mockGetClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await getTables('clickhouse');

      expect(result).toEqual(['users', 'posts', 'comments']);
    });

    it('should return empty array if query fails', async () => {
      mockGetClient.mockImplementation(() => {
        throw new Error('Query failed');
      });

      const result = await getTables('clickhouse');

      expect(result).toEqual([]);
    });

    it('should return empty array for unknown database', async () => {
      const result = await getTables('unknown');

      expect(result).toEqual([]);
    });

    it('should handle empty result', async () => {
      const mockResult = {
        json: vi.fn().mockResolvedValue([]),
      };

      mockGetClient.mockReturnValue({
        query: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await getTables('clickhouse');

      expect(result).toEqual([]);
    });
  });

  describe('ClickHouse config from env vars', () => {
    it('should use CLICKHOUSE_USERNAME', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      process.env.CLICKHOUSE_USERNAME = 'admin';

      const mockResult = { json: vi.fn().mockResolvedValue([{ '1': 1 }]) };

      mockGetClient
        .mockImplementationOnce(() => {
          throw new Error('ClickHouse connection not initialized');
        })
        .mockReturnValueOnce({
          query: vi.fn().mockResolvedValue(mockResult),
        });

      await validateConnection('clickhouse');

      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'admin',
        })
      );
    });

    it('should use CLICKHOUSE_USER as fallback', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      process.env.CLICKHOUSE_USER = 'testuser';

      const mockResult = { json: vi.fn().mockResolvedValue([{ '1': 1 }]) };

      mockGetClient
        .mockImplementationOnce(() => {
          throw new Error('ClickHouse connection not initialized');
        })
        .mockReturnValueOnce({
          query: vi.fn().mockResolvedValue(mockResult),
        });

      await validateConnection('clickhouse');

      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
        })
      );
    });

    it('should use CLICKHOUSE_PASSWORD', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      process.env.CLICKHOUSE_PASSWORD = 'secret';

      const mockResult = { json: vi.fn().mockResolvedValue([{ '1': 1 }]) };

      mockGetClient
        .mockImplementationOnce(() => {
          throw new Error('ClickHouse connection not initialized');
        })
        .mockReturnValueOnce({
          query: vi.fn().mockResolvedValue(mockResult),
        });

      await validateConnection('clickhouse');

      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'secret',
        })
      );
    });

    it('should use CLICKHOUSE_PASS as fallback', async () => {
      process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
      process.env.CLICKHOUSE_PASS = 'testpass';

      const mockResult = { json: vi.fn().mockResolvedValue([{ '1': 1 }]) };

      mockGetClient
        .mockImplementationOnce(() => {
          throw new Error('ClickHouse connection not initialized');
        })
        .mockReturnValueOnce({
          query: vi.fn().mockResolvedValue(mockResult),
        });

      await validateConnection('clickhouse');

      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'testpass',
        })
      );
    });
  });
});
