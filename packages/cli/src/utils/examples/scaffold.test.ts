import { describe, expect, it } from 'vitest';
import { detectPackageManager, renderNextBlock, rewriteReadmeForScaffold, rewriteWorkspaceRanges } from './scaffold.js';

describe('rewriteWorkspaceRanges', () => {
  it('pins workspace ranges to recorded versions and falls back to the tag', () => {
    const pkg = {
      dependencies: { '@hypequery/clickhouse': 'workspace:*', '@hypequery/serve': 'workspace:^', react: '^19.0.0' },
      devDependencies: { '@hypequery/cli': 'workspace:*' },
    };
    const changes = rewriteWorkspaceRanges(pkg, { '@hypequery/clickhouse': '2.14.0' }, 'latest');
    expect(pkg.dependencies).toEqual({ '@hypequery/clickhouse': '2.14.0', '@hypequery/serve': 'latest', react: '^19.0.0' });
    expect(pkg.devDependencies).toEqual({ '@hypequery/cli': 'latest' });
    expect(changes.map((c) => `${c.name}=${c.to}`)).toEqual(['@hypequery/clickhouse=2.14.0', '@hypequery/serve=latest', '@hypequery/cli=latest']);
  });
});

describe('rewriteReadmeForScaffold', () => {
  it('points the seed and sibling links at the scaffold and the website', () => {
    const readme = [
      'docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or',
      '- [materialized-view-rollups](../materialized-view-rollups): pre-aggregate',
      '- [p95-latency](../../recipes/p95-latency): the p95 tile',
    ].join('\n');
    const out = rewriteReadmeForScaffold(readme);
    expect(out).toContain('docker compose -f seed/docker-compose.yml up -d --wait && (cd seed && pnpm install && pnpm seed)');
    expect(out).toContain('](https://hypequery.com/examples/materialized-view-rollups)');
    expect(out).toContain('](https://hypequery.com/recipes/p95-latency)');
  });
});

describe('detectPackageManager', () => {
  it('reads the running package manager from the user agent', () => {
    expect(detectPackageManager('npm/10.9.4 node/v22.0.0')).toBe('npm');
    expect(detectPackageManager('pnpm/10.0.0 node/v22.0.0')).toBe('pnpm');
    expect(detectPackageManager('yarn/4.0.0 npm/? node/v22')).toBe('yarn');
    expect(detectPackageManager('bun/1.1.0 npm/? node/v22')).toBe('bun');
    expect(detectPackageManager('')).toBe('pnpm');
  });
});

describe('renderNextBlock', () => {
  it('always names the next command, adapted to the package manager', () => {
    const block = renderNextBlock({
      slug: 'nextjs-dashboard',
      dir: 'nextjs-dashboard',
      packageManager: 'npm',
      installed: false,
      hasSeed: true,
      run: { install: 'pnpm install', dev: 'pnpm dev', test: 'pnpm test' },
      url: 'https://hypequery.com/examples/nextjs-dashboard',
    });
    expect(block).toContain('Next:');
    expect(block).toContain('cd nextjs-dashboard');
    expect(block).toContain('docker compose -f seed/docker-compose.yml up -d --wait');
    expect(block).toContain('(cd seed && npm install && npm run seed)');
    expect(block).toContain('\n  npm install\n  npm run dev\n');
    expect(block).toContain('Test: npm run test');
    const installed = renderNextBlock({ slug: 'x', dir: 'x', packageManager: 'pnpm', installed: true, hasSeed: false, run: { install: 'pnpm install', dev: 'pnpm dev', test: 'pnpm test' }, url: 'u' });
    expect(installed).not.toContain('pnpm install');
    expect(installed).not.toContain('docker compose');
    expect(installed).toContain('  pnpm dev');
  });
});
