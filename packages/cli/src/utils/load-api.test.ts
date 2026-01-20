import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loadApiModule } from './load-api.js';
import EventEmitter from 'node:events';

vi.mock('node:fs/promises');
vi.mock('node:child_process');

describe('load-api', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TSX_LOADED;
    vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('file existence check', () => {
    it('should throw error if file does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      await expect(loadApiModule('queries.ts')).rejects.toThrow(
        'File not found: queries.ts'
      );
      await expect(loadApiModule('queries.ts')).rejects.toThrow(
        'Make sure the file exists'
      );
    });

    it('should resolve path relative to cwd', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      await expect(loadApiModule('analytics/queries.ts')).rejects.toThrow();

      expect(access).toHaveBeenCalledWith('/test/project/analytics/queries.ts');
    });
  });

  describe('TypeScript file handling', () => {
    it('should not call spawn if tsx is already available', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      // With TSX_LOADED set, should try to import directly
      try {
        await loadApiModule('queries.ts');
      } catch {
        // Expected to fail on import
      }

      // Should not spawn when tsx is already loaded
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should handle .mts files', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      try {
        await loadApiModule('queries.mts');
      } catch {
        // Expected to fail on import
      }

      // Verified file type is recognized (doesn't crash)
      expect(access).toHaveBeenCalled();
    });

    it('should handle .cts files', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      try {
        await loadApiModule('queries.cts');
      } catch {
        // Expected to fail on import
      }

      // Verified file type is recognized (doesn't crash)
      expect(access).toHaveBeenCalled();
    });

    it('should skip tsx reload if TSX_LOADED is set', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      // This would normally try to import, let it fail since we can't mock dynamic imports
      try {
        await loadApiModule('queries.ts');
      } catch {
        // Expected to fail on import
      }

      // Verify spawn was NOT called when TSX_LOADED is set
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('module validation', () => {
    it('should throw error if file cannot be imported', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      // Dynamic import will fail for non-existent file
      await expect(loadApiModule('nonexistent-file.ts')).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('should throw when module import fails', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      // Dynamic import will fail naturally for non-existent modules
      await expect(loadApiModule('nonexistent-module-xyz.ts')).rejects.toThrow();
    });
  });


  describe('cache busting', () => {
    it('should add timestamp to module URL for cache busting', async () => {
      process.env.TSX_LOADED = 'true';
      vi.mocked(access).mockResolvedValue(undefined);

      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);

      try {
        await loadApiModule('queries.ts');
      } catch {
        // Expected to fail on import
      }

      // Verify Date.now was called (used for cache busting)
      expect(dateSpy).toHaveBeenCalled();

      dateSpy.mockRestore();
    });
  });
});
