import { describe, it, expect, vi, beforeEach } from 'vitest';
import prompts from 'prompts';
import {
  promptClickHouseConnection,
  promptInitDatabase,
  promptChdbStorage,
  promptOutputDirectory,
  promptInitStyle,
  promptInitAuthMode,
  promptGenerateExample,
  promptTableSelection,
  promptDatasetTableSelection,
  confirmWithoutPackageJson,
  confirmOverwrite,
  promptRetry,
  promptContinueWithoutDb,
  PromptCancelledError,
  isPromptCancelled,
} from './prompts.js';
import { logger } from './logger.js';

vi.mock('prompts');
vi.mock('./logger.js');

type PromptOptions = { onCancel?: () => void };

/**
 * Make the mocked `prompts` behave like a genuinely aborted prompt: invoke the
 * `onCancel` callback it was handed, then resolve without the answer key.
 */
function mockUserCancels() {
  vi.mocked(prompts).mockImplementation((async (_questions: unknown, options?: PromptOptions) => {
    options?.onCancel?.();
    return {};
  }) as unknown as typeof prompts);
}

describe('prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cancellation', () => {
    // Ctrl+C has to abort the command. Before this was wired up, an aborted
    // prompt was indistinguishable from an unanswered one, so every caller's
    // `?? default` answered on the user's behalf and init scaffolded a project
    // the user was trying to bail out of.
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['promptClickHouseConnection', () => promptClickHouseConnection()],
      ['promptInitDatabase', () => promptInitDatabase()],
      ['promptChdbStorage', () => promptChdbStorage()],
      ['promptOutputDirectory', () => promptOutputDirectory()],
      ['promptInitStyle', () => promptInitStyle()],
      ['promptInitAuthMode', () => promptInitAuthMode()],
      ['confirmWithoutPackageJson', () => confirmWithoutPackageJson('/tmp/project')],
      ['promptGenerateExample', () => promptGenerateExample()],
      ['promptTableSelection', () => promptTableSelection(['users'])],
      ['promptDatasetTableSelection', () => promptDatasetTableSelection(['users'])],
      ['confirmOverwrite', () => confirmOverwrite(['file.ts'])],
      ['promptRetry', () => promptRetry('Retry?')],
      ['promptContinueWithoutDb', () => promptContinueWithoutDb()],
    ];

    it.each(cases)('%s rejects when the user aborts', async (_name, run) => {
      mockUserCancels();

      await expect(run()).rejects.toBeInstanceOf(PromptCancelledError);
    });

    it('aborts when credentials are cancelled after the URL was answered', async () => {
      vi.mocked(prompts)
        .mockImplementationOnce((async () => ({ host: 'http://localhost:8123' })) as unknown as typeof prompts)
        .mockImplementationOnce((async (_questions: unknown, options?: PromptOptions) => {
          options?.onCancel?.();
          return {};
        }) as unknown as typeof prompts);

      await expect(promptClickHouseConnection()).rejects.toBeInstanceOf(PromptCancelledError);
    });

    it('identifies cancellation errors and ignores unrelated ones', () => {
      expect(isPromptCancelled(new PromptCancelledError())).toBe(true);
      expect(isPromptCancelled(new Error('connection refused'))).toBe(false);
      expect(isPromptCancelled(undefined)).toBe(false);
    });

    it('hands prompts an onCancel handler', async () => {
      vi.mocked(prompts).mockResolvedValue({ style: 'queries' });

      await promptInitStyle();

      expect(prompts).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ onCancel: expect.any(Function) }),
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

      vi.mocked(prompts)
        .mockResolvedValueOnce({ host: mockConnection.host })
        .mockResolvedValueOnce({
          database: mockConnection.database,
          username: mockConnection.username,
          password: mockConnection.password,
        });

      const result = await promptClickHouseConnection();

      expect(result).toEqual(mockConnection);
    });

    it('should return null if user skips host', async () => {
      vi.mocked(prompts).mockResolvedValue({ host: '' });

      const result = await promptClickHouseConnection();

      expect(result).toBeNull();
      expect(prompts).toHaveBeenCalledTimes(1);
    });

    it('should use environment variables as defaults', async () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        CLICKHOUSE_URL: 'http://test:8123',
        CLICKHOUSE_DATABASE: 'test_db',
        CLICKHOUSE_USERNAME: 'test_user',
        CLICKHOUSE_PASSWORD: 'test_pass',
      };

      vi.mocked(prompts)
        .mockResolvedValueOnce({ host: 'http://test:8123' })
        .mockResolvedValueOnce({
          database: 'test_db',
          username: 'test_user',
          password: 'test_pass',
        });

      await promptClickHouseConnection();

      expect(prompts).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          name: 'host',
          initial: 'http://test:8123',
        }),
        expect.anything(),
      );
      expect(prompts).toHaveBeenNthCalledWith(
        2,
        expect.arrayContaining([
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
        ]),
        expect.anything(),
      );

      process.env = originalEnv;
    });

    it('should leave initial prompts empty when env vars not set', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.CLICKHOUSE_URL;
      delete process.env.CLICKHOUSE_HOST;
      delete process.env.CLICKHOUSE_DATABASE;
      delete process.env.CLICKHOUSE_USERNAME;
      delete process.env.CLICKHOUSE_PASSWORD;

      vi.mocked(prompts)
        .mockResolvedValueOnce({ host: 'http://localhost:8123' })
        .mockResolvedValueOnce({
          database: 'default',
          username: 'default',
          password: '',
        });

      await promptClickHouseConnection();

      expect(prompts).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          name: 'host',
          initial: '',
        }),
        expect.anything(),
      );
      expect(prompts).toHaveBeenNthCalledWith(
        2,
        expect.arrayContaining([
          expect.objectContaining({ initial: '' }),
        ]),
        expect.anything(),
      );

      process.env = originalEnv;
    });
  });

  describe('promptInitDatabase', () => {
    it('returns the selected database driver', async () => {
      vi.mocked(prompts).mockResolvedValue({ database: 'chdb' });

      await expect(promptInitDatabase()).resolves.toBe('chdb');
    });

    it('defaults to ClickHouse when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      await expect(promptInitDatabase()).resolves.toBe('clickhouse');
    });
  });

  describe('promptChdbStorage', () => {
    it('defaults to an in-memory session when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      await expect(promptChdbStorage()).resolves.toBeUndefined();
    });

    it('returns the standard persistent directory selection', async () => {
      vi.mocked(prompts).mockResolvedValue({ storage: 'file' });

      await expect(promptChdbStorage()).resolves.toBe('./analytics.chdb');
    });

    it('returns a custom path and falls back when the path prompt yields no answer', async () => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ storage: 'custom' })
        .mockResolvedValueOnce({ path: './data/my.chdb' });

      await expect(promptChdbStorage()).resolves.toBe('./data/my.chdb');

      vi.mocked(prompts)
        .mockResolvedValueOnce({ storage: 'custom' })
        .mockResolvedValueOnce({});

      await expect(promptChdbStorage()).resolves.toBe('./analytics.chdb');
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

    it('should return default when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptOutputDirectory();

      expect(result).toBe('analytics');
    });
  });

  describe('promptInitStyle', () => {
    it('should return selected style', async () => {
      vi.mocked(prompts).mockResolvedValue({ style: 'datasets' });

      const result = await promptInitStyle();

      expect(result).toBe('datasets');
    });

    it('should default to query style when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptInitStyle();

      expect(result).toBe('queries');
    });

    it('should default the prompt selection to query-builder routes', async () => {
      vi.mocked(prompts).mockResolvedValue({ style: 'queries' });

      await promptInitStyle();

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'style',
          initial: 0,
        }),
        expect.anything(),
      );
    });
  });

  describe('promptInitAuthMode', () => {
    it('returns context authentication when selected', async () => {
      vi.mocked(prompts).mockResolvedValue({ auth: 'context' });

      await expect(promptInitAuthMode()).resolves.toBe('context');
    });

    it('defaults to no auth when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      await expect(promptInitAuthMode()).resolves.toBe('none');
    });
  });

  describe('confirmWithoutPackageJson', () => {
    it('defaults to declining when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      await expect(confirmWithoutPackageJson('/tmp/project')).resolves.toBe(false);
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('/tmp/project'),
          initial: false,
        }),
        expect.anything(),
      );
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

    it('should return false when the prompt yields no answer', async () => {
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
        }),
        expect.anything(),
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
        }),
        expect.anything(),
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
        }),
        expect.anything(),
      );
    });
  });

  describe('promptDatasetTableSelection', () => {
    it('should return selected dataset tables', async () => {
      vi.mocked(prompts).mockResolvedValue({ tables: ['orders', 'customers'] });

      const result = await promptDatasetTableSelection(['orders', 'customers', 'events']);

      expect(result).toEqual(['orders', 'customers']);
    });

    it('should return an empty list if no tables provided', async () => {
      const result = await promptDatasetTableSelection([]);

      expect(result).toEqual([]);
      expect(prompts).not.toHaveBeenCalled();
    });

    it('should preselect default tables', async () => {
      vi.mocked(prompts).mockResolvedValue({ tables: ['orders'] });

      await promptDatasetTableSelection(['orders', 'customers'], ['orders']);

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'multiselect',
          choices: expect.arrayContaining([
            expect.objectContaining({
              title: 'orders',
              selected: true,
            }),
          ]),
        }),
        expect.anything(),
      );
    });

    it('should default to no tables when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptDatasetTableSelection(['orders']);

      expect(result).toEqual([]);
    });

    it('should warn and show the first 20 tables for large databases', async () => {
      const tables = Array.from({ length: 25 }, (_, i) => `table_${i}`);
      vi.mocked(prompts).mockResolvedValue({ tables: ['table_0'] });

      await promptDatasetTableSelection(tables);

      expect(logger.warn).toHaveBeenCalledWith('Showing first 20 of 25 tables');
      const call = vi.mocked(prompts).mock.calls[0][0] as any;
      expect(call.choices).toHaveLength(20);
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
        }),
        expect.anything(),
      );
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('• file2.ts'),
        }),
        expect.anything(),
      );
      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('• file3.ts'),
        }),
        expect.anything(),
      );
    });

    it('should default to false', async () => {
      vi.mocked(prompts).mockResolvedValue({ overwrite: false });

      await confirmOverwrite(['file.ts']);

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: false,
        }),
        expect.anything(),
      );
    });

    it('should return false when the prompt yields no answer', async () => {
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
        }),
        expect.anything(),
      );
    });

    it('should default to true', async () => {
      vi.mocked(prompts).mockResolvedValue({ retry: true });

      await promptRetry('Retry?');

      expect(prompts).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: true,
        }),
        expect.anything(),
      );
    });

    it('should return false when the prompt yields no answer', async () => {
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
        }),
        expect.anything(),
      );
    });

    it('should return false when the prompt yields no answer', async () => {
      vi.mocked(prompts).mockResolvedValue({});

      const result = await promptContinueWithoutDb();

      expect(result).toBe(false);
    });
  });
});
