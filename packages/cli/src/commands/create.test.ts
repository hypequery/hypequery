import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommand } from './create.js';
import type { ExamplesIndex } from '../utils/examples/registry-index.js';

vi.mock('../utils/logger.js', () => ({ logger: { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), indent: vi.fn() } }));

const temporary: string[] = [];
async function directory(): Promise<string> {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-create-')));
  temporary.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

const index: ExamplesIndex = {
  version: 1,
  source: { repository: 'hypequery/hypequery', ref: 'main' },
  // `hypequery` is the PyPI package; it must never be looked up on npm.
  packageVersions: { '@hypequery/clickhouse': '2.14.0', '@hypequery/datasets': '0.99.0', hypequery: '0.1.0b3' },
  entries: [
    { slug: 'demo', kind: 'example', title: 'Demo example', outcome: 'o', dir: 'examples/demo', url: 'https://hypequery.com/examples/demo', markdown: 'm', source: 's', packages: ['@hypequery/clickhouse'], keywords: ['k'], run: { install: 'pnpm install', dev: 'pnpm dev', test: 'pnpm test' } },
    { slug: 'how-to', kind: 'guide', title: 'A guide', outcome: 'o', dir: 'guides/how-to', url: 'https://hypequery.com/guides/how-to', markdown: 'https://hypequery.com/guides/how-to.md', source: 's', packages: [], keywords: ['k'] },
  ],
};

/** A fake repo checkout with one example and the seed, as the sparse clone would produce. */
async function fakeSource(): Promise<string> {
  const root = await directory();
  await mkdir(path.join(root, 'examples/demo/src'), { recursive: true });
  await mkdir(path.join(root, 'examples/demo/node_modules/junk'), { recursive: true });
  await mkdir(path.join(root, 'examples/_seed'), { recursive: true });
  await writeFile(path.join(root, 'examples/demo/package.json'), JSON.stringify({ name: '@hypequery-examples/demo', dependencies: { '@hypequery/clickhouse': 'workspace:*', '@hypequery/datasets': 'workspace:*' } }));
  await writeFile(path.join(root, 'examples/demo/src/index.ts'), 'export {};\n');
  await writeFile(path.join(root, 'examples/demo/README.md'), 'docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed\n');
  await writeFile(path.join(root, 'examples/demo/node_modules/junk/x.js'), '');
  await writeFile(path.join(root, 'examples/_seed/package.json'), JSON.stringify({ name: 'seed', dependencies: { '@clickhouse/client': '^1.0.0' } }));
  await writeFile(path.join(root, 'examples/_seed/docker-compose.yml'), 'services: {}\n');
  return root;
}

const indexFetch = (async () => new Response(JSON.stringify(index), { status: 200 })) as unknown as typeof fetch;
/** 2.14.0 of clickhouse is "published"; 0.99.0 of datasets is not. */
const npmFetch = (async (url: string | URL | Request) => new Response('', { status: String(url).includes('0.99.0') ? 404 : 200 })) as unknown as typeof fetch;

describe('hypequery create', () => {
  it('scaffolds into ./<slug> with pinned versions, the seed, a rewritten README and a Next block', async () => {
    const cwd = await directory();
    const source = await fakeSource();
    const fetched: string[] = [];
    const out: string[] = [];
    const installs: string[] = [];
    await createCommand(
      'demo',
      { yes: true, tag: 'canary' },
      {
        cwd,
        fetchImpl: indexFetch,
        source: 'https://example.test/examples.json',
        npmFetch,
        packageManager: 'npm',
        fetchSource: async ({ dirs }) => {
          fetched.push(...dirs);
          return { root: source, cleanup: async () => {} };
        },
        runInstall: async (manager, dir) => {
          installs.push(`${manager}:${path.relative(cwd, dir)}`);
        },
        write: (line) => out.push(line),
      },
    );
    expect(fetched).toEqual(['examples/demo', 'examples/_seed']);
    const target = path.join(cwd, 'demo');
    const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual({ '@hypequery/clickhouse': '2.14.0', '@hypequery/datasets': 'canary' });
    expect(existsSync(path.join(target, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(target, 'seed', 'docker-compose.yml'))).toBe(true);
    expect(await readFile(path.join(target, 'README.md'), 'utf8')).toContain('docker compose -f seed/docker-compose.yml up -d --wait && (cd seed && pnpm install && pnpm seed)');
    expect(installs).toEqual(['npm:demo']);
    const block = out.join('\n');
    expect(block).toContain('Next:');
    expect(block).toContain('cd demo');
    expect(block).toContain('npm run dev');
    expect(block).not.toContain('\n  npm install\n');
  });

  it('checks only @hypequery/* packages on npm', async () => {
    const cwd = await directory();
    const source = await fakeSource();
    const looked: string[] = [];
    const trackingFetch = (async (url: string | URL | Request) => {
      looked.push(String(url));
      return npmFetch(url);
    }) as unknown as typeof fetch;
    await createCommand('demo', { yes: true, install: false }, {
      cwd,
      fetchImpl: indexFetch,
      source: 'https://example.test/examples.json',
      npmFetch: trackingFetch,
      packageManager: 'pnpm',
      fetchSource: async () => ({ root: source, cleanup: async () => {} }),
      write: () => {},
    });
    expect(looked.length).toBe(2);
    expect(looked.every((url) => url.includes('/@hypequery/'))).toBe(true);
  });

  it('honours --dir, --no-seed and --no-install and still prints Next with the install step', async () => {
    const cwd = await directory();
    const source = await fakeSource();
    const out: string[] = [];
    await createCommand('demo', { yes: true, dir: 'apps/analytics', seed: false, install: false }, {
      cwd,
      fetchImpl: indexFetch,
      source: 'https://example.test/examples.json',
      npmFetch,
      packageManager: 'pnpm',
      fetchSource: async ({ dirs }) => {
        expect(dirs).toEqual(['examples/demo']);
        return { root: source, cleanup: async () => {} };
      },
      runInstall: async () => {
        throw new Error('should not install');
      },
      write: (line) => out.push(line),
    });
    expect((await readdir(path.join(cwd, 'apps/analytics'))).sort()).toEqual(['README.md', 'package.json', 'src']);
    expect(out.join('\n')).toContain('  pnpm install\n  pnpm dev');
    expect(out.join('\n')).not.toContain('docker compose');
  });

  it('fails clearly for unknown slugs, guides, and non-empty targets', async () => {
    const cwd = await directory();
    const deps = { cwd, fetchImpl: indexFetch, source: 'https://example.test/examples.json', npmFetch, packageManager: 'pnpm' as const, runInstall: async () => {} };
    await expect(createCommand('nope', { yes: true }, deps)).rejects.toThrow('Unknown example "nope". Available: demo.');
    await expect(createCommand('how-to', { yes: true }, deps)).rejects.toThrow('is a guide, not a scaffold');
    await mkdir(path.join(cwd, 'demo'));
    await writeFile(path.join(cwd, 'demo', 'keep.txt'), '');
    await expect(createCommand('demo', { yes: true }, deps)).rejects.toThrow('already exists and is not empty');
  });

  it('cleans up the fetched source even when copying fails', async () => {
    const cwd = await directory();
    let cleaned = false;
    await expect(
      createCommand('demo', { yes: true, install: false }, {
        cwd,
        fetchImpl: indexFetch,
        source: 'https://example.test/examples.json',
        npmFetch,
        fetchSource: async () => ({ root: path.join(cwd, 'does-not-exist'), cleanup: async () => { cleaned = true; } }),
      }),
    ).rejects.toThrow();
    expect(cleaned).toBe(true);
  });
});
