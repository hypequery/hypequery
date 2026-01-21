import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type LoadApiModule = typeof import('./load-api.js')['loadApiModule'];

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(dirname, '__fixtures__');
const validApiFixture = path.join(fixturesDir, 'valid-api.js');
const invalidApiFixture = path.join(fixturesDir, 'invalid-api.js');

describe('load-api', () => {
  const originalEnv = process.env;
  let loadApiModule: LoadApiModule;
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;
  let runtimeState: { loadCount: number; shouldThrow: boolean; errorMessage: string };
  let ensureRuntimeModule: typeof import('./ensure-ts-runtime.js');

  beforeEach(async () => {
    vi.resetModules();
    loadApiModule = (await import('./load-api.js')).loadApiModule;
    ensureRuntimeModule = await import('./ensure-ts-runtime.js');
    vi.clearAllMocks();
    runtimeState = { loadCount: 0, shouldThrow: false, errorMessage: 'tsx exploded' };
    ensureRuntimeModule.resetTypeScriptRuntimeForTesting();
    ensureRuntimeModule.setTypeScriptRuntimeImporter(async () => {
      runtimeState.loadCount += 1;
      if (runtimeState.shouldThrow) {
        throw new Error(runtimeState.errorMessage);
      }
    });
    process.env = { ...originalEnv };
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
  });

  afterEach(() => {
    process.env = originalEnv;
    cwdSpy?.mockRestore();
    ensureRuntimeModule.resetTypeScriptRuntimeForTesting();
  });

  describe('file existence check', () => {
    it('throws a descriptive error when the file is missing', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      await expect(loadApiModule('queries.ts')).rejects.toThrow(
        /File not found: queries\.ts[\s\S]*Make sure the file exists/
      );
    });

    it('resolves paths relative to cwd', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      await expect(loadApiModule('analytics/queries.ts')).rejects.toThrow();

      expect(access).toHaveBeenCalledWith('/test/project/analytics/queries.ts');
    });
  });

  describe('TypeScript runtime loading', () => {
    it.each(['queries.ts', 'queries.mts', 'queries.cts', 'queries.tsx'])(
      'loads the embedded tsx runtime for %s files',
      async (file) => {
        vi.mocked(access).mockResolvedValue(undefined);

        await expect(loadApiModule(file)).rejects.toThrow('Failed to load module');
        expect(runtimeState.loadCount).toBe(1);
      }
    );

    it('skips tsx runtime when the entry file is JavaScript', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      await expect(loadApiModule('queries.js')).rejects.toThrow('Failed to load module');
      expect(runtimeState.loadCount).toBe(0);
    });

    it('surfaces the original error when tsx fails to load', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      runtimeState.shouldThrow = true;

      await expect(loadApiModule('queries.ts')).rejects.toThrow(
        /Failed to load TypeScript support[\s\S]*tsx exploded/
      );
    });
  });

  describe('module loading', () => {
    it('returns the api export when the module is valid', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      const api = await loadApiModule(validApiFixture);
      expect(api.handler).toBeTypeOf('function');
      expect(runtimeState.loadCount).toBe(0);
    });

    it('throws when the module does not export an api', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      await expect(loadApiModule(invalidApiFixture)).rejects.toThrow(
        /Invalid API module:[\s\S]*Found exports: notApi/
      );
    });
  });

  describe('error handling', () => {
    it('throws a helpful error when dynamic import fails', async () => {
      vi.mocked(access).mockResolvedValue(undefined);

      await expect(loadApiModule('nonexistent-module-xyz.ts')).rejects.toThrow(
        /Failed to load module: nonexistent-module-xyz\.ts/
      );
    });
  });

  describe('cache busting', () => {
    it('adds a timestamp to the module URL every time', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);

      await expect(loadApiModule('queries.ts')).rejects.toThrow();

      expect(dateSpy).toHaveBeenCalled();
      dateSpy.mockRestore();
    });
  });
});
