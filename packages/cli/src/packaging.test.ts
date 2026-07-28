import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(srcDir, '..', 'package.json'), 'utf8')
) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const declaredAtRuntime = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

// `fs/promises` and friends are imported bare in places, so match on the builtin root.
const builtins = new Set(builtinModules);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) return [];
    if (entry.name === 'test-utils.ts') return [];
    return [full];
  });
}

/**
 * Static (non-`import type`, non-dynamic) bare specifiers. These land on the module
 * graph of `bin/cli.js` and are resolved by Node before a single line of CLI code runs,
 * so anything here that is only a peer dependency crashes every command on a clean
 * `npx @hypequery/cli` install — including `--help`.
 */
function staticBareImports(file: string): string[] {
  // Template literals are stripped first: the scaffolding templates emit `import ... from
  // '@hypequery/serve'` as generated *output*, which is a string here, not an import.
  const source = readFileSync(file, 'utf8').replace(/`(?:[^`\\]|\\[\s\S])*`/g, '``');
  const specifiers: string[] = [];

  const importRe = /^\s*import\s+(?!type\s)(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  const exportRe = /^\s*export\s+(?!type\s)(?:[\s\S]*?\s)?from\s+['"]([^'"]+)['"]/gm;

  for (const re of [importRe, exportRe]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

/** `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg` */
function packageRoot(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('runtime dependency declarations', () => {
  it('declares every statically imported package as a real dependency', () => {
    const undeclared = sourceFiles(srcDir).flatMap(file =>
      staticBareImports(file)
        .map(packageRoot)
        .filter(name => !declaredAtRuntime.has(name) && !builtins.has(name))
        .map(name => `${path.relative(srcDir, file)} imports "${name}"`)
    );

    expect(undeclared).toEqual([]);
  });

  it('keeps @hypequery/clickhouse installable without opt-in', () => {
    // It backs `hypequery init` / `hypequery generate`. As an optional peer, package
    // managers skipped it (pnpm skips peers entirely) while the code imported it anyway.
    expect(declaredAtRuntime.has('@hypequery/clickhouse')).toBe(true);
    expect(pkg.peerDependencies?.['@hypequery/clickhouse']).toBeUndefined();
  });

  it('loads @hypequery/serve lazily, since it must come from the user project', () => {
    // serve is a peer on purpose: `hypequery dev` hands the user's own api object to
    // serveDev, so the CLI must not bundle a second instance of it.
    const staticServeImports = sourceFiles(srcDir).filter(file =>
      staticBareImports(file).some(specifier => packageRoot(specifier) === '@hypequery/serve')
    );

    expect(staticServeImports).toEqual([]);
  });
});
