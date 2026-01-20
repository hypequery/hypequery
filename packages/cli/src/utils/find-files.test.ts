import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access } from 'node:fs/promises';
import {
  findQueriesFile,
  findSchemaFile,
  findClientFile,
  hasEnvFile,
  hasGitignore,
} from './find-files.js';

vi.mock('node:fs/promises');

describe('find-files', () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock cwd to return a consistent path
    vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findQueriesFile', () => {
    it('should find custom path when provided', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await findQueriesFile('custom/path/queries.ts');

      expect(result).toBe('/test/project/custom/path/queries.ts');
      expect(access).toHaveBeenCalledWith('/test/project/custom/path/queries.ts');
      expect(access).toHaveBeenCalledTimes(1);
    });

    it('should return null if custom path does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await findQueriesFile('nonexistent.ts');

      expect(result).toBeNull();
    });

    it('should find hypequery.ts as first default location', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await findQueriesFile();

      expect(result).toBe('/test/project/hypequery.ts');
      expect(access).toHaveBeenCalledWith('/test/project/hypequery.ts');
    });

    it('should try analytics/queries.ts if hypequery.ts not found', async () => {
      vi.mocked(access)
        .mockRejectedValueOnce(new Error('ENOENT')) // hypequery.ts
        .mockResolvedValueOnce(undefined); // analytics/queries.ts

      const result = await findQueriesFile();

      expect(result).toBe('/test/project/analytics/queries.ts');
      expect(access).toHaveBeenCalledWith('/test/project/hypequery.ts');
      expect(access).toHaveBeenCalledWith('/test/project/analytics/queries.ts');
    });

    it('should try all default paths in order', async () => {
      vi.mocked(access)
        .mockRejectedValueOnce(new Error('ENOENT')) // hypequery.ts
        .mockRejectedValueOnce(new Error('ENOENT')) // analytics/queries.ts
        .mockRejectedValueOnce(new Error('ENOENT')) // src/analytics/queries.ts
        .mockResolvedValueOnce(undefined); // queries.ts

      const result = await findQueriesFile();

      expect(result).toBe('/test/project/queries.ts');
      expect(access).toHaveBeenCalledTimes(4);
    });

    it('should return null if no default paths exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await findQueriesFile();

      expect(result).toBeNull();
    });
  });

  describe('findSchemaFile', () => {
    it('should find analytics/schema.ts first', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await findSchemaFile();

      expect(result).toBe('/test/project/analytics/schema.ts');
    });

    it('should try alternative paths', async () => {
      vi.mocked(access)
        .mockRejectedValueOnce(new Error('ENOENT')) // analytics/schema.ts
        .mockResolvedValueOnce(undefined); // src/analytics/schema.ts

      const result = await findSchemaFile();

      expect(result).toBe('/test/project/src/analytics/schema.ts');
    });

    it('should return null if not found', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await findSchemaFile();

      expect(result).toBeNull();
    });
  });

  describe('findClientFile', () => {
    it('should find analytics/client.ts first', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await findClientFile();

      expect(result).toBe('/test/project/analytics/client.ts');
    });

    it('should try alternative paths', async () => {
      vi.mocked(access)
        .mockRejectedValueOnce(new Error('ENOENT')) // analytics/client.ts
        .mockRejectedValueOnce(new Error('ENOENT')) // src/analytics/client.ts
        .mockResolvedValueOnce(undefined); // client.ts

      const result = await findClientFile();

      expect(result).toBe('/test/project/client.ts');
    });

    it('should return null if not found', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await findClientFile();

      expect(result).toBeNull();
    });
  });

  describe('hasEnvFile', () => {
    it('should return true if .env exists', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await hasEnvFile();

      expect(result).toBe(true);
      expect(access).toHaveBeenCalledWith('/test/project/.env');
    });

    it('should return false if .env does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await hasEnvFile();

      expect(result).toBe(false);
    });
  });

  describe('hasGitignore', () => {
    it('should return true if .gitignore exists', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await hasGitignore();

      expect(result).toBe(true);
      expect(access).toHaveBeenCalledWith('/test/project/.gitignore');
    });

    it('should return false if .gitignore does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await hasGitignore();

      expect(result).toBe(false);
    });
  });
});
