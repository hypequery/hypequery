import { describe, expect, it, vi } from 'vitest';

const telemetry = vi.hoisted(() => ({ metrics: {} as Record<string, unknown> }));
vi.mock('../utils/telemetry/command-context.js', () => ({
  updateCommandTelemetry: (command: string, metrics: Record<string, unknown>) => {
    if (command === 'examples') Object.assign(telemetry.metrics, metrics);
  },
}));
import { examplesListCommand, formatExamplesTable } from './examples.js';
import type { ExamplesIndex } from '../utils/examples/registry-index.js';

const index: ExamplesIndex = {
  version: 1,
  source: { repository: 'hypequery/hypequery', ref: 'main' },
  packageVersions: { '@hypequery/clickhouse': '2.14.0' },
  entries: [
    { slug: 'nextjs-dashboard', kind: 'example', title: 'Dash', outcome: 'A dashboard.', dir: 'examples/nextjs-dashboard', url: 'https://hypequery.com/examples/nextjs-dashboard', markdown: 'https://hypequery.com/examples/nextjs-dashboard.md', source: 's', packages: ['@hypequery/react'], keywords: ['k'], run: { install: 'pnpm install', dev: 'pnpm dev', test: 'pnpm test' } },
    { slug: 'p95-latency', kind: 'recipe', title: 'p95', outcome: 'Percentiles.', dir: 'recipes/p95-latency', url: 'https://hypequery.com/recipes/p95-latency', markdown: 'https://hypequery.com/recipes/p95-latency.md', source: 's', packages: ['@hypequery/datasets'], keywords: ['k'] },
    { slug: 'refreshable-materialized-views', kind: 'guide', title: 'RMV', outcome: 'Guide.', dir: 'guides/refreshable-materialized-views', url: 'https://hypequery.com/guides/refreshable-materialized-views', markdown: 'm', source: 's', packages: [], keywords: ['k'], clickhouseVersion: '25.8' },
  ],
};

function fetchIndex(): typeof fetch {
  return (async () => new Response(JSON.stringify(index), { status: 200 })) as unknown as typeof fetch;
}

describe('hypequery examples list', () => {
  it('prints a table with every entry and the scaffold hint', () => {
    const table = formatExamplesTable(index);
    expect(table).toMatch(/^  nextjs-dashboard\s+example\s+A dashboard\.$/m);
    expect(table).toMatch(/^  p95-latency\s+recipe\s+Percentiles\.$/m);
    expect(table).toContain('npx @hypequery/cli create <slug> -y');
    expect(formatExamplesTable(index, 'guide')).not.toContain('nextjs-dashboard');
    expect(formatExamplesTable({ ...index, entries: [] }, 'recipe')).toBe('No recipes published yet.');
  });

  it('--json prints the index filtered by kind, loading it over HTTP', async () => {
    const lines: string[] = [];
    await examplesListCommand({ json: true, kind: 'recipe' }, { fetchImpl: fetchIndex(), source: 'https://example.test/examples.json', write: (l) => lines.push(l) });
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.entries.map((e: { slug: string }) => e.slug)).toEqual(['p95-latency']);
    expect(parsed.packageVersions['@hypequery/clickhouse']).toBe('2.14.0');
    expect(telemetry.metrics).toEqual({ output: 'json', kind_filter: 'recipe', entry_count_bucket: '1' });
  });

  it('records table output and the listed count without a filter', async () => {
    telemetry.metrics = {};
    await examplesListCommand({}, { fetchImpl: fetchIndex(), source: 'https://example.test/examples.json', write: () => {} });
    expect(telemetry.metrics).toEqual({ output: 'table', entry_count_bucket: '2-5' });
  });

  it('rejects an unknown kind and a broken index', async () => {
    await expect(examplesListCommand({ kind: 'tutorial' }, { fetchImpl: fetchIndex(), source: 'https://example.test/i.json' })).rejects.toThrow('Unknown --kind tutorial');
    const bad = (async () => new Response('{"version":2}', { status: 200 })) as unknown as typeof fetch;
    await expect(examplesListCommand({}, { fetchImpl: bad, source: 'https://example.test/i.json' })).rejects.toThrow('unexpected shape');
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(examplesListCommand({}, { fetchImpl: down, source: 'https://example.test/i.json' })).rejects.toThrow('HTTP 503');
  });
});
