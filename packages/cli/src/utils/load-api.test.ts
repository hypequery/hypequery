import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type LoadApiModule = typeof import('./load-api.js')['loadApiModule'];

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('esbuild', () => ({
  build: vi.fn(),
}));

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(dirname, '__fixtures__');
const validApiFixture = path.join(fixturesDir, 'valid-api.js');
const invalidApiFixture = path.join(fixturesDir, 'invalid-api.js');

describe('load-api', () => {
  const originalEnv = process.env;
  let loadApiModule: LoadApiModule;
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;
  let mockBuild: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const esbuild = await import('esbuild');
    mockBuild = vi.mocked(esbuild.build);
    vi.clearAllMocks();
    mockBuild.mockResolvedValue({
      outputFiles: [
        {
          path: 'out.js',
          text: 'export const api = { handler: () => {} };',
        },
      ],
    });

    loadApiModule = (await import('./load-api.js')).loadApiModule;
    vi.mocked(access).mockResolvedValue(undefined);
    process.env = { ...originalEnv };
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
  });

  afterEach(() => {
    process.env = originalEnv;
    cwdSpy?.mockRestore();
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

  describe('TypeScript bundling', () => {
    it.each(['queries.ts', 'queries.mts', 'queries.cts', 'queries.tsx'])(
      'bundles %s before importing',
      async (file) => {
        const api = await loadApiModule(file);

        expect(api.handler).toBeTypeOf('function');
        expect(mockBuild).toHaveBeenCalledTimes(1);
        expect(mockBuild.mock.calls[0][0]).toMatchObject({
          entryPoints: [`/test/project/${file}`],
        });
      }
    );

    it('skips bundling for JavaScript files', async () => {
      await loadApiModule(validApiFixture);

      expect(mockBuild).not.toHaveBeenCalled();
    });

    it('surfaces esbuild errors clearly', async () => {
      mockBuild.mockRejectedValue(new Error('syntax error'));

      await expect(loadApiModule('queries.ts')).rejects.toThrow(
        /Failed to compile queries\.ts with esbuild[\s\S]*syntax error/
      );
    });
  });

  describe('module loading', () => {
    it('returns the api export when the module is valid', async () => {
      const api = await loadApiModule(validApiFixture);
      expect(api.handler).toBeTypeOf('function');
    });

    it('throws when the module does not export an api', async () => {
      await expect(loadApiModule(invalidApiFixture)).rejects.toThrow(
        /Invalid API module:[\s\S]*Found exports: notApi/
      );
    });
  });

  describe('error handling', () => {
    it('throws a helpful error when dynamic import fails for JavaScript', async () => {
      await expect(loadApiModule('nonexistent-module-xyz.js')).rejects.toThrow(
        /Failed to load module: nonexistent-module-xyz\.js/
      );
    });

    it('throws a helpful error when esbuild cannot compile TypeScript', async () => {
      mockBuild.mockRejectedValue(new Error('missing file'));

      await expect(loadApiModule('nonexistent-module-xyz.ts')).rejects.toThrow(
        /Failed to compile nonexistent-module-xyz\.ts with esbuild/
      );
    });
  });

  describe('cache busting', () => {
    it('adds a timestamp to the module URL every time', async () => {
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);

      await loadApiModule('queries.ts');

      expect(dateSpy).toHaveBeenCalled();
      dateSpy.mockRestore();
    });
  });
});
