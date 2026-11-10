import { describe, expect, it } from 'vitest';
import { ExampleManifest, GuideManifest, Manifest, RecipeManifest } from './manifest.js';

export const validExample = {
  slug: 'nextjs-dashboard',
  kind: 'example',
  title: 'Next.js dashboard with typed ClickHouse queries',
  outcome: 'A Next.js dashboard with cross-filtering over ClickHouse, typed end to end.',
  language: 'typescript',
  stack: ['nextjs', 'react'],
  useCases: ['dashboards'],
  packages: ['@hypequery/clickhouse', '@hypequery/react'],
  keyFile: 'src/datasets/events.ts',
  env: [{ name: 'CLICKHOUSE_URL', description: 'HTTP endpoint', required: true }],
  run: { install: 'pnpm install', dev: 'pnpm dev', test: 'pnpm test' },
  exampleRequest: 'curl http://localhost:3000/api/events',
  keywords: ['clickhouse nextjs'],
  minVersion: '1.28.0',
} as const;

export const validRecipe = {
  ...validExample,
  slug: 'p95-latency',
  kind: 'recipe',
  datasetFile: 'dataset.ts',
  expectedSqlFile: 'expected.sql',
  outputFile: 'output.json',
} as const;

export const validGuide = {
  slug: 'refreshable-materialized-views',
  kind: 'guide',
  title: 'Refreshable materialized views in ClickHouse',
  outcome: 'Create, schedule, refresh, monitor and query a refreshable materialized view.',
  clickhouseVersion: '25.8',
  sqlFiles: ['sql/01-create.sql'],
  keywords: ['clickhouse refreshable materialized view'],
} as const;

describe('GuideManifest', () => {
  it('accepts a guide and applies defaults', () => {
    const parsed = GuideManifest.parse(validGuide);
    expect(parsed.packages).toEqual([]);
    expect(parsed.related).toEqual([]);
    expect(Manifest.parse(validGuide).kind).toBe('guide');
  });

  it('requires at least one SQL file and a plausible ClickHouse version', () => {
    expect(GuideManifest.safeParse({ ...validGuide, sqlFiles: [] }).success).toBe(false);
    expect(GuideManifest.safeParse({ ...validGuide, clickhouseVersion: 'latest' }).success).toBe(false);
    expect(GuideManifest.safeParse({ ...validGuide, sqlFiles: ['../x.sql'] }).success).toBe(false);
  });
});

describe('ExampleManifest', () => {
  it('accepts a complete manifest and applies defaults', () => {
    const parsed = ExampleManifest.parse(validExample);
    expect(parsed.related).toEqual([]);
    expect(parsed.leadPages).toEqual([]);
    expect(parsed.functionPages).toEqual([]);
  });

  it('rejects a non-kebab slug with a readable message', () => {
    const result = ExampleManifest.safeParse({ ...validExample, slug: 'NextJS_Dashboard' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('kebab-case');
  });

  it('caps outcome at 160 characters', () => {
    const result = ExampleManifest.safeParse({ ...validExample, outcome: 'x'.repeat(161) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['outcome']);
  });

  it('rejects unknown keys so typos surface', () => {
    const result = ExampleManifest.safeParse({ ...validExample, keywrods: ['typo'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('rejects keyFile paths that escape the folder', () => {
    for (const keyFile of ['../secret.ts', '/etc/passwd', 'src/../../x.ts']) {
      const result = ExampleManifest.safeParse({ ...validExample, keyFile });
      expect(result.success, keyFile).toBe(false);
    }
  });

  it('only allows hypequery packages', () => {
    const ok = ExampleManifest.safeParse({ ...validExample, packages: ['@hypequery/serve', 'hypequery'] });
    expect(ok.success).toBe(true);
    const bad = ExampleManifest.safeParse({ ...validExample, packages: ['react'] });
    expect(bad.success).toBe(false);
  });

  it('requires semver minVersion and at least one keyword', () => {
    expect(ExampleManifest.safeParse({ ...validExample, minVersion: '1.28' }).success).toBe(false);
    expect(ExampleManifest.safeParse({ ...validExample, keywords: [] }).success).toBe(false);
  });

  it('requires leadPages to be site paths and functionPages to be slugs', () => {
    expect(ExampleManifest.safeParse({ ...validExample, leadPages: ['/clickhouse-nextjs'] }).success).toBe(true);
    expect(ExampleManifest.safeParse({ ...validExample, leadPages: ['clickhouse-nextjs'] }).success).toBe(false);
    expect(ExampleManifest.safeParse({ ...validExample, functionPages: ['quantile'] }).success).toBe(true);
    expect(ExampleManifest.safeParse({ ...validExample, functionPages: ['/clickhouse/functions/quantile'] }).success).toBe(false);
  });
});

describe('RecipeManifest', () => {
  it('requires the three recipe files', () => {
    expect(RecipeManifest.safeParse(validRecipe).success).toBe(true);
    const { outputFile: _omit, ...withoutOutput } = validRecipe;
    expect(RecipeManifest.safeParse(withoutOutput).success).toBe(false);
  });

  it('is distinguished from an example by kind', () => {
    expect(Manifest.parse(validRecipe).kind).toBe('recipe');
    expect(Manifest.parse(validExample).kind).toBe('example');
    expect(Manifest.safeParse({ ...validExample, kind: 'guide' }).success).toBe(false);
  });
});
