import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRegistry, expandSqlIncludes, languageForFile, renderRegistry } from './registry.js';
import { validExample, validGuide, validRecipe } from './manifest.test.js';

const roots: string[] = [];

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-registry-'));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  roots.push(root);
  return root;
}

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('buildRegistry', () => {
  it('collects manifests, README, key file, recipe files and screenshots', () => {
    const root = makeRepo();
    write(root, 'examples/nextjs-dashboard/example.json', JSON.stringify({ ...validExample, leadPages: ['/clickhouse-nextjs'] }));
    write(root, 'examples/nextjs-dashboard/README.md', '# Dash\n\nBody');
    write(root, 'examples/nextjs-dashboard/src/datasets/events.ts', 'export const x = 1;\n');
    write(root, 'examples/nextjs-dashboard/screenshot.png', 'png');
    write(root, 'recipes/p95-latency/recipe.json', JSON.stringify(validRecipe));
    write(root, 'recipes/p95-latency/README.md', '# p95');
    write(root, 'recipes/p95-latency/src/datasets/events.ts', '');
    write(root, 'recipes/p95-latency/dataset.ts', 'dataset');
    write(root, 'recipes/p95-latency/expected.sql', 'SELECT 1');
    write(root, 'recipes/p95-latency/output.json', '[]');
    write(root, 'website-next/src/app/clickhouse-nextjs/page.tsx', '');

    const registry = buildRegistry({
      repoRoot: root,
      publicDir: path.join(root, 'website-next/public'),
      appDir: path.join(root, 'website-next/src/app'),
    });

    expect(registry.version).toBe(1);
    expect(registry.entries.map((e) => e.manifest.slug)).toEqual(['nextjs-dashboard', 'p95-latency']);
    const [example, recipe] = registry.entries;
    expect(example.readme).toBe('# Dash\n\nBody');
    expect(example.keyFile).toEqual({ path: 'src/datasets/events.ts', language: 'typescript', source: 'export const x = 1;\n' });
    expect(example.screenshot).toBe('/examples/nextjs-dashboard/screenshot.png');
    expect(fs.readFileSync(path.join(root, 'website-next/public/examples/nextjs-dashboard/screenshot.png'), 'utf8')).toBe('png');
    expect(recipe.recipe).toEqual({
      dataset: { path: 'dataset.ts', language: 'typescript', source: 'dataset' },
      expectedSql: 'SELECT 1',
      output: '[]',
    });
    expect(recipe.screenshot).toBeUndefined();
    expect(renderRegistry(registry).endsWith('\n')).toBe(true);
  });

  it('fails on validation issues and on lead pages that do not exist', () => {
    const root = makeRepo();
    write(root, 'examples/nextjs-dashboard/example.json', JSON.stringify({ ...validExample, leadPages: ['/clickhouse-missing'] }));
    write(root, 'examples/nextjs-dashboard/README.md', '# Dash');
    write(root, 'examples/nextjs-dashboard/src/datasets/events.ts', '');
    fs.mkdirSync(path.join(root, 'website-next/src/app'), { recursive: true });
    expect(() => buildRegistry({ repoRoot: root, appDir: path.join(root, 'website-next/src/app') }))
      .toThrow(/Examples registry has 1 problem/);
    try {
      buildRegistry({ repoRoot: root, appDir: path.join(root, 'website-next/src/app') });
    } catch (error) {
      const issues = (error as Error & { issues: Array<{ message: string }> }).issues;
      expect(issues[0].message).toContain('leadPages entry "/clickhouse-missing" has no page');
    }
  });

  it('expands {{sql:file}} includes in guide bodies and carries the SQL files', () => {
    const root = makeRepo();
    write(root, 'guides/refreshable-materialized-views/guide.json', JSON.stringify(validGuide));
    write(root, 'guides/refreshable-materialized-views/guide.md', '# Title\n\nIntro\n\n{{sql:sql/01-create.sql}}\n\nAfter');
    write(root, 'guides/refreshable-materialized-views/sql/01-create.sql', 'CREATE TABLE t (a UInt8) ENGINE = Memory;\n');
    const registry = buildRegistry({ repoRoot: root });
    const [guide] = registry.entries;
    expect(guide.manifest.kind).toBe('guide');
    expect(guide.keyFile).toBeUndefined();
    expect(guide.readme).toBe('# Title\n\nIntro\n\n```sql\nCREATE TABLE t (a UInt8) ENGINE = Memory;\n```\n\nAfter');
    expect(guide.guide?.sqlFiles).toEqual([{ path: 'sql/01-create.sql', source: 'CREATE TABLE t (a UInt8) ENGINE = Memory;\n' }]);

    const issues: Array<{ file: string; message: string }> = [];
    const out = expandSqlIncludes('{{sql:nope.sql}}', path.join(root, 'guides/refreshable-materialized-views'), 'guides/refreshable-materialized-views', issues);
    expect(out).toBe('<!-- missing nope.sql -->');
    expect(issues[0].message).toContain('{{sql:nope.sql}}');
  });

  it('maps file extensions to highlighter languages', () => {
    expect(languageForFile('a.tsx')).toBe('tsx');
    expect(languageForFile('q.SQL')).toBe('sql');
    expect(languageForFile('Dockerfile')).toBe('text');
  });
});
