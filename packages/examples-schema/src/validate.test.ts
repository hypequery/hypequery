import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatIssues, isRegistryEntry, validateRegistry } from './validate.js';
import { validExample, validRecipe } from './manifest.test.js';

const roots: string[] = [];

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-schema-'));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  roots.push(root);
  return root;
}

function writeEntry(
  root: string,
  kind: 'examples' | 'recipes',
  folder: string,
  manifest: Record<string, unknown> | string,
  files: string[] = [],
) {
  const dir = path.join(root, kind, folder);
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = kind === 'examples' ? 'example.json' : 'recipe.json';
  fs.writeFileSync(
    path.join(dir, manifestFile),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
  );
  for (const file of ['README.md', ...files]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `# ${file}\n`);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('validateRegistry', () => {
  it('passes an empty repo (no examples/ or recipes/ folders)', () => {
    const result = validateRegistry(makeRepo());
    expect(result.issues).toEqual([]);
    expect(result.manifests).toEqual([]);
  });

  it('loads valid examples and recipes', () => {
    const root = makeRepo();
    writeEntry(root, 'examples', 'nextjs-dashboard', { ...validExample, related: ['p95-latency'] }, ['src/datasets/events.ts']);
    writeEntry(root, 'recipes', 'p95-latency', validRecipe, ['src/datasets/events.ts', 'dataset.ts', 'expected.sql', 'output.json']);
    const result = validateRegistry(root);
    expect(result.issues).toEqual([]);
    expect(result.manifests.map((m) => m.dir)).toEqual(['examples/nextjs-dashboard', 'recipes/p95-latency']);
  });

  it('skips underscore-prefixed folders such as _seed', () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, 'examples', '_seed'), { recursive: true });
    fs.mkdirSync(path.join(root, 'examples', '_template'), { recursive: true });
    expect(validateRegistry(root).issues).toEqual([]);
    expect(isRegistryEntry('_seed')).toBe(false);
    expect(isRegistryEntry('nextjs-dashboard')).toBe(true);
  });

  it('fails when slug does not match the folder name', () => {
    const root = makeRepo();
    writeEntry(root, 'examples', 'dashboard', validExample, ['src/datasets/events.ts']);
    const { issues } = validateRegistry(root);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe('examples/dashboard/example.json');
    expect(issues[0].message).toBe('slug "nextjs-dashboard" does not match folder name "dashboard"');
  });

  it('reports schema errors with field paths', () => {
    const root = makeRepo();
    writeEntry(root, 'examples', 'nextjs-dashboard', { ...validExample, outcome: 'x'.repeat(200), minVersion: 'latest' }, ['src/datasets/events.ts']);
    const { issues } = validateRegistry(root);
    const messages = issues.map((i) => i.message);
    expect(messages.some((m) => m.startsWith('outcome:'))).toBe(true);
    expect(messages.some((m) => m.startsWith('minVersion:') && m.includes('semver'))).toBe(true);
  });

  it('fails on a folder with no manifest, invalid JSON, or the wrong kind for its root', () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, 'examples', 'orphan'), { recursive: true });
    writeEntry(root, 'examples', 'broken-json', '{ not json');
    writeEntry(root, 'recipes', 'nextjs-dashboard', validExample, ['src/datasets/events.ts']);
    const { issues } = validateRegistry(root);
    expect(issues.find((i) => i.file === 'examples/orphan')?.message).toContain('missing example.json');
    expect(issues.find((i) => i.file === 'examples/broken-json/example.json')?.message).toContain('invalid JSON');
    expect(issues.find((i) => i.file === 'recipes/nextjs-dashboard/recipe.json')?.message).toContain('kind must be "recipe"');
  });

  it('fails on missing referenced files and README', () => {
    const root = makeRepo();
    const dir = path.join(root, 'examples', 'nextjs-dashboard');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'example.json'), JSON.stringify(validExample));
    const { issues } = validateRegistry(root);
    const messages = issues.map((i) => i.message);
    expect(messages).toContainEqual(expect.stringContaining('missing README.md'));
    expect(messages).toContainEqual('keyFile "src/datasets/events.ts" does not exist in examples/nextjs-dashboard/');
  });

  it('fails on duplicate slugs across roots and dangling related slugs', () => {
    const root = makeRepo();
    writeEntry(root, 'examples', 'p95-latency', { ...validExample, slug: 'p95-latency', related: ['does-not-exist', 'p95-latency'] }, ['src/datasets/events.ts']);
    writeEntry(root, 'recipes', 'p95-latency', validRecipe, ['src/datasets/events.ts', 'dataset.ts', 'expected.sql', 'output.json']);
    const messages = validateRegistry(root).issues.map((i) => i.message);
    expect(messages).toContainEqual('slug "p95-latency" is already used by examples/p95-latency');
    expect(messages).toContainEqual('related slug "does-not-exist" does not match any example or recipe');
    expect(messages).toContainEqual('related must not include the entry\'s own slug "p95-latency"');
  });
});

describe('formatIssues', () => {
  it('groups messages under their file', () => {
    const text = formatIssues([
      { file: 'examples/a/example.json', message: 'first' },
      { file: 'examples/a/example.json', message: 'second' },
      { file: 'examples/b', message: 'third' },
    ]);
    expect(text).toBe('examples/a/example.json\n  - first\n  - second\nexamples/b\n  - third');
  });
});
