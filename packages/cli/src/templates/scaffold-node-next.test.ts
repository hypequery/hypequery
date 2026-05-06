import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateClientTemplate } from './client.js';
import { generateQueriesTemplate } from './queries.js';

const tempDirs: string[] = [];

async function runTypeCheck(projectDir: string): Promise<{ code: number | null; stderr: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const tscBin = path.resolve(process.cwd(), 'node_modules/typescript/bin/tsc');

  try {
    await execFileAsync(process.execPath, [tscBin, '--noEmit', '-p', projectDir], {
      cwd: projectDir,
    });
    return { code: 0, stderr: '' };
  } catch (error) {
    const failure = error as Error & { code?: number | null; stderr?: string };
    return { code: failure.code ?? 1, stderr: failure.stderr ?? failure.message };
  }
}

describe('generated scaffold NodeNext compatibility', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('passes tsc --noEmit with NodeNext imports and local module shims', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-cli-scaffold-'));
    tempDirs.push(projectDir);

    const analyticsDir = path.join(projectDir, 'analytics');
    await mkdir(path.join(projectDir, 'node_modules/@hypequery/clickhouse'), { recursive: true });
    await mkdir(path.join(projectDir, 'node_modules/@hypequery/serve'), { recursive: true });
    await mkdir(path.join(projectDir, 'node_modules/zod'), { recursive: true });
    await mkdir(analyticsDir, { recursive: true });

    await writeFile(path.join(projectDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['analytics/**/*.ts'],
    }, null, 2));

    await writeFile(path.join(projectDir, 'analytics', 'globals.d.ts'), `declare const process: {
  env: Record<string, string | undefined>;
};
`);

    await writeFile(path.join(projectDir, 'node_modules/@hypequery/clickhouse/package.json'), JSON.stringify({
      name: '@hypequery/clickhouse',
      type: 'module',
      exports: {
        '.': './index.d.ts',
      },
    }, null, 2));
    await writeFile(path.join(projectDir, 'node_modules/@hypequery/clickhouse/index.d.ts'), `export declare function createQueryBuilder<TSchema>(config: unknown): {
  table(name: string): {
    select(selection: unknown): {
      limit(count: number): {
        execute(): Promise<unknown[]>;
      };
    };
  };
};
`);

    await writeFile(path.join(projectDir, 'node_modules/@hypequery/serve/package.json'), JSON.stringify({
      name: '@hypequery/serve',
      type: 'module',
      exports: {
        '.': './index.d.ts',
      },
    }, null, 2));
    await writeFile(path.join(projectDir, 'node_modules/@hypequery/serve/index.d.ts'), `export declare function initServe(config: unknown): {
  query: <TOutput>(definition: {
    description: string;
    output?: unknown;
    query: (args: { ctx: { db: ReturnType<typeof import('@hypequery/clickhouse').createQueryBuilder> } }) => Promise<TOutput> | TOutput;
  }) => typeof definition;
  serve: (config: { queries: Record<string, unknown> }) => {
    queries: Record<string, unknown>;
    route(path: string, query: unknown): void;
    execute(name: string): Promise<unknown>;
  };
};
export type InferApiType<T> = T;
export type InferQueryResult<TApi, TName extends string> = unknown;
`);

    await writeFile(path.join(projectDir, 'node_modules/zod/package.json'), JSON.stringify({
      name: 'zod',
      type: 'module',
      exports: {
        '.': './index.d.ts',
      },
    }, null, 2));
    await writeFile(path.join(projectDir, 'node_modules/zod/index.d.ts'), `export declare const z: {
  object<T extends Record<string, unknown>>(shape: T): { shape: T };
  boolean(): boolean;
};
`);

    await writeFile(path.join(analyticsDir, 'schema.ts'), `export interface IntrospectedSchema {}
`);
    await writeFile(path.join(analyticsDir, 'client.ts'), generateClientTemplate());
    await writeFile(path.join(analyticsDir, 'queries.ts'), generateQueriesTemplate({ hasExample: false }));

    const result = await runTypeCheck(projectDir);
    expect(result.code, result.stderr).toBe(0);
  });
});
