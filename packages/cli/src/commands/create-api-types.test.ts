import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import * as findFiles from '../utils/find-files.js';
import * as loadApi from '../utils/load-api.js';
import { logger } from '../utils/logger.js';
import { mockProcessExit, ProcessExitError } from '../test-utils.js';
import ora from 'ora';

// Mock dependencies
vi.mock('node:fs/promises');
vi.mock('../utils/find-files.js');
vi.mock('../utils/load-api.js');
vi.mock('../utils/logger.js');
vi.mock('ora');

// Import after mocks
let createApiTypesCommand: any;

describe('create-api-types command', () => {
  let exitHandler: ReturnType<typeof mockProcessExit>;
  let mockSpinner: any;

  beforeEach(async () => {
    const module = await import('./create-api-types.js');
    createApiTypesCommand = module.createApiTypesCommand;

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
    vi.mocked(findFiles.findQueriesFile).mockResolvedValue('/app/queries.ts');
    vi.mocked(loadApi.loadApiModule).mockResolvedValue({
      queries: {
        getUsers: {},
        getPosts: {},
        createPost: {},
      },
    });
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    exitHandler.restore();
  });

  describe('Happy path', () => {
    it('should generate client types successfully', async () => {
      await createApiTypesCommand();

      expect(findFiles.findQueriesFile).toHaveBeenCalledWith(undefined);
      expect(loadApi.loadApiModule).toHaveBeenCalledWith('/app/queries.ts');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Loaded serve API');
      expect(logger.success).toHaveBeenCalledWith('Mapped 3 queries');
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('client.ts'),
        expect.stringContaining('export type HypequeryApi'),
        'utf8'
      );
    });

    it('should write to default output location', async () => {
      await createApiTypesCommand();

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('/app/client.ts'),
        expect.any(String),
        'utf8'
      );
    });

    it('should write to custom output location', async () => {
      await createApiTypesCommand(undefined, { output: 'custom/types.ts' });

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('custom/types.ts'),
        expect.any(String),
        'utf8'
      );
    });

    it('should use custom type name', async () => {
      await createApiTypesCommand(undefined, { name: 'CustomApi' });

      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('export type CustomApi'),
        'utf8'
      );
    });

    it('should create output directory if it does not exist', async () => {
      await createApiTypesCommand(undefined, { output: 'deeply/nested/types.ts' });

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('deeply/nested'),
        { recursive: true }
      );
    });

    it('should display success message with relative path', async () => {
      await createApiTypesCommand();

      expect(logger.success).toHaveBeenCalledWith(expect.stringMatching(/Wrote .+client\.ts/));
    });

    it('should display usage hint', async () => {
      await createApiTypesCommand();

      expect(logger.info).toHaveBeenCalledWith(
        'Import the generated type and pass it to createHooks() or your HTTP client.'
      );
    });

    it('should handle singular query count', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({
        queries: {
          getSingleQuery: {},
        },
      });

      await createApiTypesCommand();

      expect(logger.success).toHaveBeenCalledWith('Mapped 1 query');
    });
  });

  describe('Error paths', () => {
    it('should handle missing queries file', async () => {
      vi.mocked(findFiles.findQueriesFile).mockResolvedValue(null);

      try {
        await createApiTypesCommand();
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
        expect((error as ProcessExitError).code).toBe(1);
      }

      expect(logger.error).toHaveBeenCalledWith('Could not find queries file');
      expect(logger.indent).toHaveBeenCalledWith('• analytics/queries.ts');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle module loading errors', async () => {
      vi.mocked(loadApi.loadApiModule).mockRejectedValue(new Error('Module syntax error'));

      try {
        await createApiTypesCommand();
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(mockSpinner.fail).toHaveBeenCalledWith('Failed to generate client types');
      expect(logger.error).toHaveBeenCalledWith('Module syntax error');
      expect(exitHandler.exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle file write errors', async () => {
      vi.mocked(writeFile).mockRejectedValue(new Error('EACCES: permission denied'));

      try {
        await createApiTypesCommand();
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('EACCES: permission denied');
    });

    it('should handle directory creation errors', async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error('Cannot create directory'));

      try {
        await createApiTypesCommand();
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('Cannot create directory');
    });

    it('should handle non-Error thrown values', async () => {
      vi.mocked(loadApi.loadApiModule).mockRejectedValue('string error');

      try {
        await createApiTypesCommand();
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessExitError);
      }

      expect(logger.error).toHaveBeenCalledWith('string error');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty queries object', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({ queries: {} });

      await createApiTypesCommand();

      expect(logger.warn).toHaveBeenCalledWith(
        'Generated client for an empty serve catalog. Add queries to your API file.'
      );
      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('// No queries registered yet'),
        'utf8'
      );
    });

    it('should handle missing queries property', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({});

      await createApiTypesCommand();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('empty serve catalog')
      );
    });

    it('should sort query keys alphabetically', async () => {
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({
        queries: {
          zQuery: {},
          aQuery: {},
          mQuery: {},
        },
      });

      await createApiTypesCommand();

      const generatedCode = vi.mocked(writeFile).mock.calls[0][1] as string;
      const aIndex = generatedCode.indexOf('aQuery:');
      const mIndex = generatedCode.indexOf('mQuery:');
      const zIndex = generatedCode.indexOf('zQuery:');

      expect(aIndex).toBeLessThan(mIndex);
      expect(mIndex).toBeLessThan(zIndex);
    });

    it('should generate timestamp in output', async () => {
      await createApiTypesCommand();

      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/\/\/ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        'utf8'
      );
    });

    it('should generate "do not edit" warning', async () => {
      await createApiTypesCommand();

      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('// Do not edit manually.'),
        'utf8'
      );
    });

    it('should handle queries file in different location', async () => {
      vi.mocked(findFiles.findQueriesFile).mockResolvedValue('/custom/path/queries.ts');

      await createApiTypesCommand('/custom/path/queries.ts');

      expect(findFiles.findQueriesFile).toHaveBeenCalledWith('/custom/path/queries.ts');
    });

    it('should handle large number of queries', async () => {
      const queries: Record<string, {}> = {};
      for (let i = 0; i < 100; i++) {
        queries[`query${i}`] = {};
      }
      vi.mocked(loadApi.loadApiModule).mockResolvedValue({ queries });

      await createApiTypesCommand();

      expect(logger.success).toHaveBeenCalledWith('Mapped 100 queries');
    });

    it('should generate correct import path for nested files', async () => {
      vi.mocked(findFiles.findQueriesFile).mockResolvedValue('/app/src/api/queries.ts');

      await createApiTypesCommand(undefined, { output: '/app/src/client.ts' });

      const generatedCode = vi.mocked(writeFile).mock.calls[0][1] as string;
      expect(generatedCode).toContain("from './api/queries'");
    });
  });
});
