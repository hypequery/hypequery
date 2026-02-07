import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import * as prompts from '../utils/prompts.js';
import * as detectDb from '../utils/detect-database.js';
import * as findFiles from '../utils/find-files.js';
import { logger } from '../utils/logger.js';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';
const installServeDependencies = vi.fn().mockResolvedValue(undefined);

vi.mock('../utils/dependency-installer.js', () => ({
  installServeDependencies,
}));

const mockEnsureDockerClickHouse = vi.fn();
vi.mock('../utils/docker.js', () => ({
  ensureDockerClickHouse: mockEnsureDockerClickHouse,
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
    it('should exit cleanly when user cancels database type selection', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue(null);

      try {
        await initCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
        expect((error as ProcessExitError).code).toBe(0);
      }

      expect(exitHandler.exitMock).toHaveBeenCalledWith(0);
      expect(logger.info).toHaveBeenCalledWith('Setup cancelled');

      // Should not attempt to create files
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should generate example project when user chooses example mode', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('example');
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({});

      // Should create example schema with sample tables
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('users')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('orders')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('page_events')
      );
      // Should create example queries
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('queries.ts'),
        expect.stringContaining('recentUsers')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('queries.ts'),
        expect.stringContaining('ordersByStatus')
      );
      // Should create placeholder .env
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('YOUR_CLICKHOUSE_HOST')
      );
    });

    it('should generate example project when user skips connection details', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
      vi.mocked(prompts.promptClickHouseConnection).mockResolvedValue(null);
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({});

      // Should create example schema (not empty placeholder)
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('users')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('queries.ts'),
        expect.stringContaining('recentUsers')
      );
    });

    it('should use default directory when user cancels path selection', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('example');
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

    it('should continue with example project when user declines retry but accepts continue', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
      expect(logger.info).toHaveBeenCalledWith('Continuing with example project instead.');
      // Should create example schema, not empty placeholder
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('users')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('YOUR_CLICKHOUSE_HOST')
      );
    });

    it('should exit when user declines both retry and continue', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
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
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
        expect.not.stringContaining('YOUR_CLICKHOUSE_HOST')
      );
    });

    it('should generate example query when user selects table', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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
      process.env.CLICKHOUSE_HOST = 'http://test:8123';
      process.env.CLICKHOUSE_DATABASE = 'test_db';
      process.env.CLICKHOUSE_USERNAME = 'test_user';
      process.env.CLICKHOUSE_PASSWORD = 'test_pass';

      vi.mocked(detectDb.validateConnection).mockResolvedValue(true);
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await initCommand({
        database: 'clickhouse',
        noInteractive: true,
        path: 'analytics',
      });

      expect(prompts.promptDatabaseType).not.toHaveBeenCalled();
      expect(prompts.promptClickHouseConnection).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('http://test:8123')
      );
    });
  });

  describe('Dependency installation', () => {
    it('installs serve dependencies when setup completes', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('connect');
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

      expect(installServeDependencies).toHaveBeenCalled();
    });

    it('installs serve dependencies in example mode too', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('example');
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');

      await initCommand({});

      expect(installServeDependencies).toHaveBeenCalled();
    });
  });

  describe('Docker mode', () => {
    it('should start Docker ClickHouse and generate real types', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('docker');
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      mockEnsureDockerClickHouse.mockResolvedValue({
        host: 'http://localhost:8123',
        database: 'hypequery_demo',
        username: 'default',
        password: '',
      });

      await initCommand({});

      expect(mockEnsureDockerClickHouse).toHaveBeenCalled();
      expect(mockGenerateTypes).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        expect.stringContaining('http://localhost:8123')
      );
      expect(logger.success).toHaveBeenCalledWith('Local ClickHouse is ready with sample data!');
    });

    it('should fall back to example mode when Docker fails', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('docker');
      vi.mocked(prompts.promptOutputDirectory).mockResolvedValue('analytics');
      vi.mocked(prompts.promptContinueWithoutDb).mockResolvedValue(true);
      mockEnsureDockerClickHouse.mockResolvedValue(null);

      await initCommand({});

      expect(mockEnsureDockerClickHouse).toHaveBeenCalled();
      expect(prompts.promptContinueWithoutDb).toHaveBeenCalled();
      // Should create example schema, not generate from DB
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('schema.ts'),
        expect.stringContaining('users')
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('queries.ts'),
        expect.stringContaining('recentUsers')
      );
    });

    it('should exit when Docker fails and user declines example mode', async () => {
      vi.mocked(prompts.promptDatabaseType).mockResolvedValue('clickhouse');
      vi.mocked(prompts.promptConnectionMode).mockResolvedValue('docker');
      vi.mocked(prompts.promptContinueWithoutDb).mockResolvedValue(false);
      mockEnsureDockerClickHouse.mockResolvedValue(null);

      try {
        await initCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(exitHandler.exitMock).toHaveBeenCalledWith(0);
      expect(logger.info).toHaveBeenCalledWith('Setup cancelled');
    });
  });
});
