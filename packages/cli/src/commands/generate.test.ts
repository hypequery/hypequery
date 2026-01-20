import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as findFiles from '../utils/find-files.js';
import * as detectDb from '../utils/detect-database.js';
import { logger } from '../utils/logger.js';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';
import ora from 'ora';

// Mock dependencies
vi.mock('../utils/find-files.js');
vi.mock('../utils/detect-database.js');
vi.mock('../utils/logger.js');
vi.mock('ora');

// Mock generateTypes function
const mockGenerateTypes = vi.fn();
vi.mock('@hypequery/clickhouse/cli', () => ({
  generateTypes: mockGenerateTypes,
}));

// Import after mocks
let generateCommand: any;

describe('generate command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let mockSpinner: any;

  beforeEach(async () => {
    // Import after mocks are set up
    const module = await import('./generate.js');
    generateCommand = module.generateCommand;

    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    // Setup ora mock
    mockSpinner = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
    };
    vi.mocked(ora).mockReturnValue(mockSpinner);

    // Setup default mocks
    vi.mocked(findFiles.findSchemaFile).mockResolvedValue(null);
    vi.mocked(detectDb.getTableCount).mockResolvedValue(10);
    mockGenerateTypes.mockResolvedValue(undefined);

    // Mock process.env
    process.env.CLICKHOUSE_HOST = 'localhost';
  });

  afterEach(() => {
    exitHandler.restore();
    delete process.env.CLICKHOUSE_HOST;
  });

  describe('Happy path', () => {
    it('should generate types successfully with default output path', async () => {
      await generateCommand({});

      expect(logger.header).toHaveBeenCalledWith('hypequery generate');
      expect(detectDb.getTableCount).toHaveBeenCalledWith('clickhouse');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Connected to ClickHouse');
      expect(logger.success).toHaveBeenCalledWith('Found 10 tables');
      expect(mockGenerateTypes).toHaveBeenCalledWith(expect.stringContaining('analytics/schema.ts'));
      expect(logger.header).toHaveBeenCalledWith('Types regenerated successfully!');
    });

    it('should use custom output path when provided', async () => {
      await generateCommand({ output: 'custom/schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(expect.stringContaining('custom/schema.ts'));
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('custom/schema.ts'));
    });

    it('should use existing schema file when found', async () => {
      vi.mocked(findFiles.findSchemaFile).mockResolvedValue('/app/src/schema.ts');

      await generateCommand({});

      expect(mockGenerateTypes).toHaveBeenCalledWith('/app/src/schema.ts');
    });

    it('should display correct table count', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(25);

      await generateCommand({});

      expect(logger.success).toHaveBeenCalledWith('Found 25 tables');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Generated types for 25 tables');
    });

    it('should handle zero tables', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(0);

      await generateCommand({});

      expect(logger.success).toHaveBeenCalledWith('Found 0 tables');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Generated types for 0 tables');
    });

    it('should display relative output path', async () => {
      await generateCommand({ output: 'schemas/clickhouse.ts' });

      expect(logger.success).toHaveBeenCalledWith(expect.stringMatching(/schemas\/clickhouse\.ts/));
    });

    it('should show connecting spinner', async () => {
      await generateCommand({});

      expect(ora).toHaveBeenCalledWith('Connecting to ClickHouse...');
      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it('should show generating types spinner', async () => {
      await generateCommand({});

      expect(ora).toHaveBeenCalledWith('Generating types...');
    });
  });

  describe('Error paths', () => {
    it('should handle database connection refused (ECONNREFUSED)', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:9000');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      try {
        await generateCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
        expect((error as ProcessExitError).code).toBe(1);
      }

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to generate types');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
      expect(logger.info).toHaveBeenCalledWith('This usually means:');
      expect(logger.indent).toHaveBeenCalledWith('• ClickHouse is not running');
      expect(logger.indent).toHaveBeenCalledWith('• Wrong host/port in configuration');
      expect(logger.indent).toHaveBeenCalledWith('• Firewall blocking connection');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should display CLICKHOUSE_HOST env var in error', async () => {
      process.env.CLICKHOUSE_HOST = 'db.example.com';
      const error = new Error('connect ECONNREFUSED');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      try {
        await generateCommand({});
      } catch (error) {
        // Expected to exit
      }

      expect(logger.indent).toHaveBeenCalledWith('CLICKHOUSE_HOST=db.example.com');
    });

    it('should handle missing CLICKHOUSE_HOST env var', async () => {
      delete process.env.CLICKHOUSE_HOST;
      const error = new Error('connect ECONNREFUSED');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      try {
        await generateCommand({});
      } catch (error) {
        // Expected to exit
      }

      expect(logger.indent).toHaveBeenCalledWith('CLICKHOUSE_HOST=not set');
    });

    it('should handle database connection timeout', async () => {
      const error = new Error('Connection timeout');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      try {
        await generateCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to generate types');
      expect(logger.error).toHaveBeenCalledWith('Connection timeout');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle authentication errors', async () => {
      const error = new Error('Authentication failed: invalid credentials');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      try {
        await generateCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('Authentication failed: invalid credentials');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle type generation errors', async () => {
      mockGenerateTypes.mockRejectedValue(new Error('Failed to write file'));

      try {
        await generateCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to generate types');
      expect(logger.error).toHaveBeenCalledWith('Failed to write file');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle write permission errors', async () => {
      mockGenerateTypes.mockRejectedValue(new Error('EACCES: permission denied'));

      try {
        await generateCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('EACCES: permission denied');
    });

    it('should handle non-Error thrown values', async () => {
      vi.mocked(detectDb.getTableCount).mockRejectedValue('string error');

      try {
        await generateCommand({});
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('string error');
    });

    it('should show documentation link for connection errors', async () => {
      const error = new Error('connect ECONNREFUSED');
      vi.mocked(detectDb.getTableCount).mockRejectedValue(error);

      try {
        await generateCommand({});
      } catch (error) {
        // Expected to exit
      }

      expect(logger.info).toHaveBeenCalledWith(
        'Docs: https://hypequery.com/docs/troubleshooting#connection-errors'
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle absolute output path', async () => {
      const absolutePath = '/absolute/path/schema.ts';
      await generateCommand({ output: absolutePath });

      expect(mockGenerateTypes).toHaveBeenCalledWith(expect.stringContaining('/absolute/path/schema.ts'));
    });

    it('should handle relative output path', async () => {
      await generateCommand({ output: '../schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(expect.stringContaining('schema.ts'));
    });

    it('should handle output path with directories that need creation', async () => {
      await generateCommand({ output: 'deeply/nested/path/schema.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(expect.stringContaining('deeply/nested/path/schema.ts'));
    });

    it('should handle table count of 1 (singular)', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(1);

      await generateCommand({});

      expect(logger.success).toHaveBeenCalledWith('Found 1 tables');
    });

    it('should handle large number of tables', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(500);

      await generateCommand({});

      expect(logger.success).toHaveBeenCalledWith('Found 500 tables');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Generated types for 500 tables');
    });

    it('should prefer custom output over existing schema file', async () => {
      vi.mocked(findFiles.findSchemaFile).mockResolvedValue('/existing/schema.ts');

      await generateCommand({ output: 'custom.ts' });

      expect(mockGenerateTypes).toHaveBeenCalledWith(expect.stringContaining('custom.ts'));
      expect(mockGenerateTypes).not.toHaveBeenCalledWith('/existing/schema.ts');
    });

    it('should show newlines for proper spacing', async () => {
      await generateCommand({});

      // Should show newlines at start and end
      expect(logger.newline).toHaveBeenCalled();
    });
  });
});
