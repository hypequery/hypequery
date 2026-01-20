import { describe, it, expect, vi, beforeEach } from 'vitest';
import prompts from 'prompts';
import {
  promptDatabaseType,
  promptClickHouseConnection,
  promptOutputDirectory,
  promptGenerateExample,
  promptTableSelection,
  confirmOverwrite,
  promptRetry,
  promptContinueWithoutDb,
} from './prompts.js';
import { logger } from './logger.js';

vi.mock('prompts');
vi.mock('./logger.js');

describe('prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('promptDatabaseType', () => {
    it('should return selected database type', async () => {
      vi.mocked(prompts).mockResolvedValue({ database: 'clickhouse' });

      const result = await promptDatabaseType();

      expect(result).toBe('clickhouse');
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'select',
          name: 'database',
          message: 'Which database are you using?',
        })
      );
    });

    it('should return null if user cancels', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptDatabaseType();

      expect(result).toBeNull();
    });

    it('should show clickhouse as first option', async () => {
      vi.mocked(prompts).mockResolvedValue({ database: 'clickhouse' });

      await promptDatabaseType();

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: expect.arrayContaining([
            expect.objectContaining({ title: 'ClickHouse', value: 'clickhouse' }),
          ]),
        })
      );
    });
  });

  describe('promptClickHouseConnection', () => {
    it('should return connection details', async () => {
      const mockConnection = {
        host: 'http://localhost:8123',
        database: 'analytics',
        username: 'admin',
        password: 'secret',
      };

      vi.mocked(prompts).mockResolvedValue(mockConnection);

      const result = await promptClickHouseConnection();

      expect(result).toEqual(mockConnection);
    });

    it('should return null if user skips host', async () => {
      vi.mocked(prompts).mockResolvedValue({ host: '' });

      const result = await promptClickHouseConnection();

      expect(result).toBeNull();
    });

    it('should use environment variables as defaults', async () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        CLICKHOUSE_HOST: 'http://test:8123',
        CLICKHOUSE_DATABASE: 'test_db',
        CLICKHOUSE_USERNAME: 'test_user',
        CLICKHOUSE_PASSWORD: 'test_pass',
      };

      vi.mocked(prompts).mockResolvedValue({
        host: 'http://test:8123',
        database: 'test_db',
        username: 'test_user',
        password: 'test_pass',
      });

      await promptClickHouseConnection();

      expect(prompts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'host',
            initial: 'http://test:8123',
          }),
          expect.objectContaining({
            name: 'database',
            initial: 'test_db',
          }),
          expect.objectContaining({
            name: 'username',
            initial: 'test_user',
          }),
          expect.objectContaining({
            name: 'password',
            initial: 'test_pass',
          }),
        ])
      );

      process.env = originalEnv;
    });

    it('should leave initial prompts empty when env vars not set', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.CLICKHOUSE_HOST;
      delete process.env.CLICKHOUSE_DATABASE;
      delete process.env.CLICKHOUSE_USERNAME;
      delete process.env.CLICKHOUSE_PASSWORD;

      vi.mocked(prompts).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: '',
      });

      await promptClickHouseConnection();

      expect(prompts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ initial: '' }),
          expect.objectContaining({ initial: '' }),
        ])
      );

      process.env = originalEnv;
    });
  });

  describe('promptOutputDirectory', () => {
    it('should return analytics directory by default', async () => {
      vi.mocked(prompts).mockResolvedValue({ directory: 'analytics' });

      const result = await promptOutputDirectory();

      expect(result).toBe('analytics');
    });

    it('should return src/analytics when selected', async () => {
      vi.mocked(prompts).mockResolvedValue({ directory: 'src/analytics' });

      const result = await promptOutputDirectory();

      expect(result).toBe('src/analytics');
    });

    it('should prompt for custom path when custom selected', async () => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ directory: 'custom' })
        .mockResolvedValueOnce({ path: 'my/custom/path' });

      const result = await promptOutputDirectory();

      expect(result).toBe('my/custom/path');
      expect(prompts).toHaveBeenCalledTimes(2);
    });

    it('should use default if custom path is empty', async () => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ directory: 'custom' })
        .mockResolvedValueOnce({ path: '' });

      const result = await promptOutputDirectory();

      expect(result).toBe('analytics');
    });

    it('should return default if user cancels', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptOutputDirectory();

      expect(result).toBe('analytics');
    });
  });

  describe('promptGenerateExample', () => {
    it('should return true when user confirms', async () => {
      vi.mocked(prompts).mockResolvedValue({ generate: true });

      const result = await promptGenerateExample();

      expect(result).toBe(true);
    });

    it('should return false when user declines', async () => {
      vi.mocked(prompts).mockResolvedValue({ generate: false });

      const result = await promptGenerateExample();

      expect(result).toBe(false);
    });

    it('should return false when user cancels', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptGenerateExample();

      expect(result).toBe(false);
    });

    it('should default to true', async () => {
      vi.mocked(prompts).mockResolvedValue({ generate: true });

      await promptGenerateExample();

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: true,
        })
      );
    });
  });

  describe('promptTableSelection', () => {
    it('should return selected table', async () => {
      vi.mocked(prompts).mockResolvedValue({ table: 'users' });

      const result = await promptTableSelection(['users', 'posts', 'comments']);

      expect(result).toBe('users');
    });

    it('should return null if no tables provided', async () => {
      const result = await promptTableSelection([]);

      expect(result).toBeNull();
      expect(prompts).not.toHaveBeenCalled();
    });

    it('should show warning if more than 10 tables', async () => {
      const tables = Array.from({ length: 15 }, (_, i) => `table_${i}`);
      vi.mocked(prompts).mockResolvedValue({ table: 'table_0' });

      await promptTableSelection(tables);

      expect(logger.warn).toHaveBeenCalledWith('Showing first 10 of 15 tables');
      expect(logger.indent).toHaveBeenCalled();
    });

    it('should only show first 10 tables', async () => {
      const tables = Array.from({ length: 15 }, (_, i) => `table_${i}`);
      vi.mocked(prompts).mockResolvedValue({ table: 'table_0' });

      await promptTableSelection(tables);

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'table_0' }),
            expect.objectContaining({ value: 'table_9' }),
            expect.objectContaining({ title: 'Skip example', value: null }),
          ]),
        })
      );

      const call = vi.mocked(prompts).mock.calls[0][0] as any;
      // 10 tables + 1 skip option = 11 choices
      expect(call.choices).toHaveLength(11);
    });

    it('should include skip option', async () => {
      vi.mocked(prompts).mockResolvedValue({ table: null });

      const result = await promptTableSelection(['users']);

      expect(result).toBeNull();
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: expect.arrayContaining([
            expect.objectContaining({ title: 'Skip example', value: null }),
          ]),
        })
      );
    });
  });

  describe('confirmOverwrite', () => {
    it('should return true when user confirms', async () => {
      vi.mocked(prompts).mockResolvedValue({ overwrite: true });

      const result = await confirmOverwrite(['file1.ts', 'file2.ts']);

      expect(result).toBe(true);
    });

    it('should return false when user declines', async () => {
      vi.mocked(prompts).mockResolvedValue({ overwrite: false });

      const result = await confirmOverwrite(['file1.ts']);

      expect(result).toBe(false);
    });

    it('should show list of files in message', async () => {
      vi.mocked(prompts).mockResolvedValue({ overwrite: true });

      await confirmOverwrite(['file1.ts', 'file2.ts', 'file3.ts']);

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('• file1.ts'),
        })
      );
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('• file2.ts'),
        })
      );
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('• file3.ts'),
        })
      );
    });

    it('should default to false', async () => {
      vi.mocked(prompts).mockResolvedValue({ overwrite: false });

      await confirmOverwrite(['file.ts']);

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: false,
        })
      );
    });

    it('should return false when user cancels', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await confirmOverwrite(['file.ts']);

      expect(result).toBe(false);
    });
  });

  describe('promptRetry', () => {
    it('should return true when user wants to retry', async () => {
      vi.mocked(prompts).mockResolvedValue({ retry: true });

      const result = await promptRetry('Operation failed. Retry?');

      expect(result).toBe(true);
    });

    it('should return false when user declines', async () => {
      vi.mocked(prompts).mockResolvedValue({ retry: false });

      const result = await promptRetry('Try again?');

      expect(result).toBe(false);
    });

    it('should use custom message', async () => {
      vi.mocked(prompts).mockResolvedValue({ retry: true });

      await promptRetry('Custom retry message?');

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Custom retry message?',
        })
      );
    });

    it('should default to true', async () => {
      vi.mocked(prompts).mockResolvedValue({ retry: true });

      await promptRetry('Retry?');

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: true,
        })
      );
    });

    it('should return false when user cancels', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptRetry('Retry?');

      expect(result).toBe(false);
    });
  });

  describe('promptContinueWithoutDb', () => {
    it('should return true when user wants to continue', async () => {
      vi.mocked(prompts).mockResolvedValue({ continue: true });

      const result = await promptContinueWithoutDb();

      expect(result).toBe(true);
    });

    it('should return false when user declines', async () => {
      vi.mocked(prompts).mockResolvedValue({ continue: false });

      const result = await promptContinueWithoutDb();

      expect(result).toBe(false);
    });

    it('should default to true', async () => {
      vi.mocked(prompts).mockResolvedValue({ continue: true });

      await promptContinueWithoutDb();

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: true,
        })
      );
    });

    it('should return false when user cancels', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptContinueWithoutDb();

      expect(result).toBe(false);
    });
  });
});
