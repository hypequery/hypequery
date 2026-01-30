import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as findFiles from '../utils/find-files.js';
import * as loadApi from '../utils/load-api.js';
import * as detectDb from '../utils/detect-database.js';
import { logger } from '../utils/logger.js';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';

// Mock dependencies
vi.mock('esbuild', () => ({
  build: vi.fn(async () => ({
    outputFiles: [
      {
        path: 'out.js',
        text: 'export const api = { handler: () => {} };',
      },
    ],
  })),
}));
vi.mock('../utils/find-files.js');
vi.mock('../utils/load-api.js');
vi.mock('../utils/detect-database.js');
vi.mock('../utils/logger.js');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

// Mock @hypequery/serve
const mockServeDev = vi.fn();
const mockServerStop = vi.fn();
vi.mock('@hypequery/serve', () => ({
  serveDev: mockServeDev,
}));

// Mock open package
const mockOpen = vi.fn();
vi.mock('open', () => ({
  default: mockOpen,
}));

// Mock node:fs watch to prevent actual watchers
vi.mock('node:fs', () => ({
  watch: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

// Import after mocks
let devCommand: any;

describe('dev command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    // Import after mocks are set up
    const module = await import('./dev.js');
    devCommand = module.devCommand;

    exitHandler = mockProcessExit();
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(findFiles.findQueriesFile).mockResolvedValue('/app/queries.ts');
    vi.mocked(loadApi.loadApiModule).mockResolvedValue({
      queries: {
        getUsers: {},
        getPosts: {},
      },
    });
    vi.mocked(detectDb.getTableCount).mockResolvedValue(5);

    mockServeDev.mockResolvedValue({
      server: {
        address: () => ({ port: 4000, address: 'localhost' }),
      },
      stop: mockServerStop,
    });
    mockServerStop.mockResolvedValue(undefined);
    mockOpen.mockResolvedValue(undefined);
  });

  afterEach(() => {
    exitHandler.restore();
  });

  describe('Happy path (watch disabled for testing)', () => {
    it('should start dev server successfully', async () => {
      await devCommand(undefined, { watch: false });

      expect(findFiles.findQueriesFile).toHaveBeenCalledWith(undefined);
      expect(loadApi.loadApiModule).toHaveBeenCalledWith('/app/queries.ts');
      expect(mockServeDev).toHaveBeenCalledWith(
        expect.objectContaining({
          queries: expect.any(Object),
        }),
        expect.objectContaining({
          quiet: true,
        })
      );
      expect(logger.success).toHaveBeenCalledWith('Registered 2 queries');
    });

    it('should load queries file from custom path', async () => {
      vi.mocked(findFiles.findQueriesFile).mockResolvedValue('/custom/queries.ts');

      await devCommand('/custom/queries.ts', { watch: false });

      expect(findFiles.findQueriesFile).toHaveBeenCalledWith('/custom/queries.ts');
    });

    it('should display table count when available', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(10);

      await devCommand(undefined, { watch: false });

      expect(detectDb.getTableCount).toHaveBeenCalledWith('clickhouse');
      expect(logger.success).toHaveBeenCalledWith('Registered 2 queries');
    });

    it('should not display table count when zero', async () => {
      vi.mocked(detectDb.getTableCount).mockResolvedValue(0);

      await devCommand(undefined, { watch: false });

      expect(logger.success).not.toHaveBeenCalledWith(expect.stringContaining('Connected to ClickHouse'));
    });

    it('should handle custom port and hostname', async () => {
      await devCommand(undefined, {
        watch: false,
        port: 3000,
        hostname: '0.0.0.0',
      });

      expect(mockServeDev).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          port: 3000,
          hostname: '0.0.0.0',
        })
      );
    });

    it('should display correct URLs in box', async () => {
      mockServeDev.mockResolvedValue({
        server: {
          address: () => ({ port: 5000, address: '127.0.0.1' }),
        },
        stop: mockServerStop,
      });

      await devCommand(undefined, { watch: false, port: 5000 });

      expect(logger.box).toHaveBeenCalledWith(
        expect.arrayContaining([
          'Docs:     http://localhost:5000/docs',
          'OpenAPI:  http://localhost:5000/openapi.json',
        ])
      );
    });

    it('should open browser when --open flag is set', async () => {
      await devCommand(undefined, { watch: false, open: true });

      expect(mockOpen).toHaveBeenCalledWith('http://localhost:4000');
    });

    it('should not log caching messages', async () => {
      await devCommand(undefined, { watch: false, cache: 'redis' });

      expect(logger.success).not.toHaveBeenCalledWith(expect.stringContaining('Caching enabled'));
    });

    it('should not display cache status when cache=none', async () => {
      await devCommand(undefined, { watch: false, cache: 'none' });

      expect(logger.success).not.toHaveBeenCalledWith(expect.stringContaining('Caching enabled'));
    });
  });

  describe('Error paths', () => {
    it('should handle missing queries file gracefully', async () => {
      vi.mocked(findFiles.findQueriesFile).mockResolvedValue(null);

      try {
        await devCommand(undefined, { watch: false });
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
        expect((error as ProcessExitError).code).toBe(1);
      }

      expect(logger.error).toHaveBeenCalledWith('Could not find queries file');
      expect(logger.info).toHaveBeenCalledWith('Expected one of:');
      expect(logger.indent).toHaveBeenCalledWith('• analytics/queries.ts');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle table count retrieval failure silently', async () => {
      vi.mocked(detectDb.getTableCount).mockRejectedValue(new Error('Connection refused'));

      await devCommand(undefined, { watch: false });

      // Should not throw - error is caught and ignored
      expect(mockServeDev).toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalledWith(expect.stringContaining('Connected to ClickHouse'));
    });

    it('should handle module loading errors', async () => {
      vi.mocked(loadApi.loadApiModule).mockRejectedValue(new Error('Module not found'));

      try {
        await devCommand(undefined, { watch: false });
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('Failed to start server');
      expect(logger.info).toHaveBeenCalledWith('Module not found');
    });

    it('should handle server start failures (port in use)', async () => {
      mockServeDev.mockRejectedValue(new Error('Port 4000 already in use'));

      try {
        await devCommand(undefined, { watch: false });
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('Failed to start server');
      expect(logger.info).toHaveBeenCalledWith('Port 4000 already in use');
    });

    it('should handle browser open failure silently', async () => {
      mockOpen.mockRejectedValue(new Error('open package not found'));

      await devCommand(undefined, { watch: false, open: true });

      // Should not throw - error is caught and ignored
      expect(mockServeDev).toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Ready'));
    });

    it('should display stack trace when error has stack', async () => {
      const errorWithStack = new Error('Test error');
      errorWithStack.stack = 'Error: Test error\n  at test.js:10:5';
      vi.mocked(loadApi.loadApiModule).mockRejectedValue(errorWithStack);

      try {
        await devCommand(undefined, { watch: false });
      } catch (error) {
        // Expected to exit
      }

      expect(logger.info).toHaveBeenCalledWith('Stack trace:');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('at test.js:10:5'));
    });

    it('should handle non-Error thrown values', async () => {
      vi.mocked(loadApi.loadApiModule).mockRejectedValue('string error');

      try {
        await devCommand(undefined, { watch: false });
      } catch (error) {
        // Expected to exit
      }

      expect(logger.error).toHaveBeenCalledWith('Failed to start server');
      expect(logger.info).toHaveBeenCalledWith('string error');
    });
  });

  describe('Edge cases', () => {
    it('should handle query count of 1 (singular form)', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({
        queries: {
          getUser: {},
        },
      });

      await devCommand(undefined, { watch: false });

      expect(logger.success).toHaveBeenCalledWith('Registered 1 query');
    });

    it('should handle zero queries', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({
        queries: {},
      });

      await devCommand(undefined, { watch: false });

      expect(logger.success).toHaveBeenCalledWith('Registered 0 queries');
    });

    it('should handle missing queries object', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({});

      await devCommand(undefined, { watch: false });

      expect(logger.success).toHaveBeenCalledWith('Registered 0 queries');
    });

    it('should handle server address as null (fallback to port)', async () => {
      mockServeDev.mockResolvedValue({
        server: {
          address: () => null,
        },
        stop: mockServerStop,
      });

      await devCommand(undefined, { watch: false, port: 3000 });

      // Should fall back to options.port
      expect(logger.box).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('http://localhost:3000'),
        ])
      );
    });

    it('should default to port 4000 when not specified', async () => {
      mockServeDev.mockResolvedValue({
        server: {
          address: () => null,
        },
        stop: mockServerStop,
      });

      await devCommand(undefined, { watch: false });

      expect(logger.box).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('http://localhost:4000'),
        ])
      );
    });

    it('should use specified hostname in URLs', async () => {
      await devCommand(undefined, { watch: false, hostname: '0.0.0.0' });

      expect(logger.box).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('http://0.0.0.0:4000'),
        ])
      );
    });

    it('should display header with hypequery dev', async () => {
      await devCommand(undefined, { watch: false });

      expect(logger.header).toHaveBeenCalledWith('hypequery dev');
    });

    it('should display "Ready" message with uptime', async () => {
      await devCommand(undefined, { watch: false });

      expect(logger.success).toHaveBeenCalledWith(expect.stringMatching(/^Ready in \d+ms$/));
    });

    it('should display "Query execution stats: Coming soon!" message', async () => {
      await devCommand(undefined, { watch: false });

      expect(logger.info).toHaveBeenCalledWith('💡 Query execution stats: Coming soon!');
    });
  });
});
