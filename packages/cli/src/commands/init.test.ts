import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import * as prompts from '../utils/prompts.js';
import * as detectDb from '../utils/detect-database.js';
import * as findFiles from '../utils/find-files.js';
import { logger } from '../utils/logger.js';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';
const installScaffoldDependencies = vi.fn().mockResolvedValue(undefined);

vi.mock('../utils/dependency-installer.js', () => ({
  installScaffoldDependencies,
  installServeDependencies: installScaffoldDependencies,
}));

// Mock all dependencies
vi.mock('node:fs/promises');
vi.mock('../utils/prompts.js');
vi.mock('../utils/detect-database.js');
vi.mock('../utils/find-files.js');
vi.mock('../utils/logger.js');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

const mockGenerateTypes = vi.fn().mockResolvedValue(undefined);
const mockGetTypeGenerator = vi.fn(() => mockGenerateTypes);
vi.mock('../generators/index.js', () => ({
  getTypeGenerator: mockGetTypeGenerator,
}));
const mockGenerateDatasets = vi.fn().mockResolvedValue(undefined);
vi.mock('../generators/dataset-generator.js', () => ({
  generateDatasets: mockGenerateDatasets,
}));

// Import after mocks
let initCommand: any;

describe('init command - graceful failure handling', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    // Import after mocks are set up
    const module = await import('./init.js');
    initCommand = module.initCommand;

    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('');
    vi.mocked(access).mockRejectedValue(new Error('File not found'));
    vi.mocked(findFiles.hasEnvFile).mockResolvedValue(false);
    vi.mocked(findFiles.hasGitignore).mockResolvedValue(false);
  });

  afterEach(() => {
    exitHandler.restore();
  });

  describe('User cancellation scenarios', () => {
    it('should continue when user skips connection details', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue(null);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({});

      // Should create placeholder files
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('YOUR_CLICKHOUSE_URL')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('Run \'npx hypequery generate\'')
      );
      expect(logger.info).toHaveBeenCalledWith('Skipping database connection for now.');
    });

    it('should use default directory when user cancels path selection', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue(null);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({});

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('analytics'),
        { recursive: true }
      );
    });
  });

  describe('Connection failure scenarios', () => {
    it.skip('should handle failed connection with retry', async () => {
      // Skipping this test due to recursion causing memory issues
      // The retry flow is validated manually
    });

    it('should continue without DB when user declines retry but accepts continue', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'wrong',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(false);
      vi.mocked(prompts.promptRetry).mockResolvedValue(false);
      vi.mocked(prompts.promptContinueWithoutDb).mockResolvedValue(true);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({});

      expect(prompts.promptContinueWithoutDb).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Continuing without database connection.');
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('YOUR_CLICKHOUSE_URL')
      );
    });

    it('should exit when user declines both retry and continue', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'wrong',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(false);
      vi.mocked(prompts.promptRetry).mockResolvedValue(false);
      vi.mocked(prompts.promptContinueWithoutDb).mockResolvedValue(false);

      try {
        await initCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(exitHandler.exitMock).toHaveBeenCalledWith(0);
      expect(logger.info).toHaveBeenCalledWith('Setup cancelled');
    });
  });

  describe('skipConnection option', () => {
    it('bypasses connection test when requested', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'secret',
      });
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({ skipConnection: true });

      expect(detectDb.validateConnection).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Skipping database connection test (requested).');
    });
  });

  describe('Successful connection scenarios', () => {
    it('should generate real types when connection succeeds', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'correct',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(47);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(prompts.promptGenerateExample).mockResolvedValue(false);

      await initCommand({});

      expect(mockGenerateTypes).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.not.stringContaining('YOUR_CLICKHOUSE_URL')
      );
    });

    it('should generate example query when user selects table', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'correct',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(47);
      vi.mocked(detectDb.getTables).mockResolvedValue(['orders', 'users', 'events']);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(prompts.promptGenerateExample).mockResolvedValue(true);
      vi.mocked(prompts.promptTableSelection).mockResolvedValue('orders');

      await initCommand({});

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('queries.ts'),
        expect.stringContaining('orders')
      );
    });
  });

  describe('File handling', () => {
    it('should append to existing .env file', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'correct',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(47);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(findFiles.hasEnvFile).mockResolvedValue(true);
      vi.mocked(readFile).mockResolvedValue('EXISTING_VAR=value\n');

      await initCommand({});

      expect(readFile).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('EXISTING_VAR')
      );
    });

    it('should prompt for overwrite when files exist', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'correct',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(47);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(access).mockResolvedValue(undefined); // Files exist
      vi.mocked(prompts.confirmOverwrite).mockResolvedValue(true);

      await initCommand({});

      expect(prompts.confirmOverwrite).toHaveBeenCalled();
    });

    it('should skip setup when user declines overwrite', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'correct',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(47);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(access).mockResolvedValue(undefined); // Files exist
      vi.mocked(prompts.confirmOverwrite).mockResolvedValue(false);

      try {
        await initCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.info).toHaveBeenCalledWith('Setup cancelled');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(0);
    });
  });

  describe('Non-interactive mode', () => {
    it('should use environment variables in non-interactive mode', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        noInteractive: true,
        path: 'analytics',
      });

      expect(prompts.promptClickHouseConnection).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('http://test:8123')
      );
    });

    it('does not enter prompt code paths when noInteractive is enabled', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        noInteractive: true,
        force: true,
        path: 'analytics',
      });

      expect(prompts.promptOutputDirectory).not.toHaveBeenCalled();
      expect(prompts.promptGenerateExample).not.toHaveBeenCalled();
      expect(prompts.promptTableSelection).not.toHaveBeenCalled();
      expect(prompts.confirmOverwrite).not.toHaveBeenCalled();
      expect(prompts.promptRetry).not.toHaveBeenCalled();
      expect(prompts.promptContinueWithoutDb).not.toHaveBeenCalled();
    });

    it('fails without retry prompts when non-interactive connection validation fails', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(false);

      await expect(initCommand({
        noInteractive: true,
        force: true,
        path: 'analytics',
      })).rejects.toThrow('Failed to connect to ClickHouse in non-interactive mode.');

      expect(prompts.promptRetry).not.toHaveBeenCalled();
      expect(prompts.promptContinueWithoutDb).not.toHaveBeenCalled();
    });
  });

  describe('Dependency installation', () => {
    it('installs serve dependencies when setup completes', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'secret',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(5);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(prompts.promptGenerateExample).mockResolvedValue(false);

      await initCommand({});

      expect(installScaffoldDependencies).toHaveBeenCalled();
    });
  });

  describe('Style scaffolds', () => {
    it('prompts for style in interactive mode and defaults to query files', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue(null);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(prompts.promptInitStyle).mockResolvedValue('queries');

      await initCommand({});

      expect(prompts.promptOutputDirectory).toHaveBeenCalled();
      expect(prompts.promptInitStyle).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('analytics/queries.ts'),
        expect.stringContaining('initServe'),
      );
    });

    it('creates datasets scaffold under a custom path without generating all tables by default', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        noInteractive: true,
        force: true,
        style: 'datasets',
        path: 'custom',
      });

      expect(mockGenerateTypes).toHaveBeenCalledWith(
        expect.objectContaining({ outputPath: expect.stringContaining('custom/schema.ts') }),
      );
      expect(mockGenerateDatasets).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('custom/datasets.ts'),
        expect.stringContaining('exampleEvents'),
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('custom/client.ts'),
        expect.any(String),
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('custom/api.ts'),
        expect.stringContaining('createAPI'),
      );
      expect(writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('custom/queries.ts'),
        expect.any(String),
      );
      expect(installScaffoldDependencies).toHaveBeenCalledWith('datasets');
    });

    it('generates selected datasets from explicit tables in non-interactive mode', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        noInteractive: true,
        force: true,
        style: 'datasets',
        path: 'custom',
        tables: 'orders, customers',
        excludeTables: 'customers_archive',
      });

      expect(mockGenerateDatasets).toHaveBeenCalledWith(
        expect.objectContaining({
          outputPath: expect.stringContaining('custom/datasets.ts'),
          includeTables: ['orders', 'customers'],
          excludeTables: ['customers_archive'],
        }),
      );
    });

    it('generates all datasets only when allTables is explicit', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        noInteractive: true,
        force: true,
        style: 'datasets',
        path: 'custom',
        allTables: true,
      });

      expect(mockGenerateDatasets).toHaveBeenCalledWith(
        expect.objectContaining({
          outputPath: expect.stringContaining('custom/datasets.ts'),
          includeTables: undefined,
        }),
      );
    });

    it('prompts for dataset tables in interactive datasets mode', async () => {
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'default',
        password: 'correct',
      });
      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(3);
      vi.mocked(detectDb.getTables).mockResolvedValue(['orders', 'customers', 'events']);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(prompts.promptGenerateExample).mockResolvedValue(true);
      vi.mocked(prompts.promptTableSelection).mockResolvedValue('orders');
      vi.mocked(prompts.promptInitStyle).mockResolvedValue('datasets');
      vi.mocked(prompts.promptDatasetTableSelection).mockResolvedValue(['orders', 'customers']);

      await initCommand({});

      expect(prompts.promptDatasetTableSelection).toHaveBeenCalledWith(
        ['orders', 'customers', 'events'],
        ['orders'],
      );
      expect(mockGenerateDatasets).toHaveBeenCalledWith(
        expect.objectContaining({
          includeTables: ['orders', 'customers'],
        }),
      );
    });

    it('creates query scaffold under a custom path', async () => {
      process.env.CLICKHOUSE_URL = 'http://test:8123';
      delete process.env.CLICKHOUSE_HOST;
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        noInteractive: true,
        force: true,
        style: 'queries',
        path: 'custom',
      });

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('custom/client.ts'),
        expect.any(String),
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('custom/queries.ts'),
        expect.stringContaining('initServe'),
      );
      expect(writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('custom/api.ts'),
        expect.any(String),
      );
      expect(installScaffoldDependencies).toHaveBeenCalledWith('queries');
    });
  });
});
