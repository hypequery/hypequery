import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger.js';
import { installScaffoldDependencies, resolveScaffoldPackages } from './dependency-installer.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

describe('dependency installer', () => {
  const originalEnv = process.env;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, npm_config_user_agent: 'pnpm/10.0.0 node/v22.0.0' };
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/project');
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout?: NodeJS.ReadableStream;
        stderr?: NodeJS.ReadableStream;
      };
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    cwdSpy.mockRestore();
  });

  it('keeps stable scaffold packages for non-canary CLI versions', () => {
    expect(resolveScaffoldPackages('1.1.1')).toEqual([
      '@hypequery/clickhouse',
      '@hypequery/serve',
      'zod',
    ]);
  });

  it('pins sibling packages to the same canary version', () => {
    expect(resolveScaffoldPackages('0.0.0-canary-20260506195711')).toEqual([
      '@hypequery/clickhouse@0.0.0-canary-20260506195711',
      '@hypequery/serve@0.0.0-canary-20260506195711',
      'zod',
    ]);
  });

  it('installs matching canary siblings plus zod when missing', async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify({
        name: 'fixture-app',
        packageManager: 'pnpm@10.0.0',
        dependencies: {},
      }))
      .mockResolvedValueOnce(JSON.stringify({
        name: '@hypequery/cli',
        version: '0.0.0-canary-20260506195711',
      }));

    await installScaffoldDependencies();

    expect(spawnMock).toHaveBeenCalledWith(
      'pnpm',
      [
        'add',
        '@hypequery/clickhouse@0.0.0-canary-20260506195711',
        '@hypequery/serve@0.0.0-canary-20260506195711',
        'zod',
      ],
      expect.objectContaining({
        cwd: '/tmp/project',
        stdio: 'inherit',
      })
    );
    expect(logger.success).toHaveBeenCalledWith(
      'Installed @hypequery/clickhouse@0.0.0-canary-20260506195711, @hypequery/serve@0.0.0-canary-20260506195711, zod'
    );
  });

  it('does not reinstall dependencies that are already present', async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify({
        name: 'fixture-app',
        packageManager: 'pnpm@10.0.0',
        dependencies: {
          '@hypequery/clickhouse': '0.0.0-canary-20260506195711',
          '@hypequery/serve': '0.0.0-canary-20260506195711',
          zod: '^3.25.0',
        },
      }))
      .mockResolvedValueOnce(JSON.stringify({
        name: '@hypequery/cli',
        version: '0.0.0-canary-20260506195711',
      }));

    await installScaffoldDependencies();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('upgrades existing stable sibling deps to the matching canary version', async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify({
        name: 'fixture-app',
        packageManager: 'pnpm@10.0.0',
        dependencies: {
          '@hypequery/clickhouse': '^1.6.2',
          '@hypequery/serve': '^0.2.0',
        },
      }))
      .mockResolvedValueOnce(JSON.stringify({
        name: '@hypequery/cli',
        version: '0.0.0-canary-20260506195711',
      }));

    await installScaffoldDependencies();

    expect(spawnMock).toHaveBeenCalledWith(
      'pnpm',
      [
        'add',
        '@hypequery/clickhouse@0.0.0-canary-20260506195711',
        '@hypequery/serve@0.0.0-canary-20260506195711',
        'zod',
      ],
      expect.any(Object)
    );
  });
});
