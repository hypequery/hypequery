import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
} from '@hypequery/protocol';
import { build } from 'esbuild';
import { findNearestTsconfig } from './load-api.js';

const deploymentBuildSourceSymbol = Symbol.for('hypequery.deployment-build-source.v1');

interface DeploymentBuildSource {
  readonly version: 1;
  readonly runtimeEntrypoints: readonly unknown[];
}

interface RuntimeEndpoint {
  readonly query?: unknown;
}

interface RuntimeApi {
  readonly queries?: Readonly<Record<string, RuntimeEndpoint>>;
  readonly [deploymentBuildSourceSymbol]?: DeploymentBuildSource;
}

export interface NodeRuntimeArtifact {
  readonly bytes: Uint8Array;
  readonly artifactSha256: string;
  readonly entrypointPrefix: string;
  readonly runtimeEntrypoints: readonly string[];
}

function executableQuery(query: unknown): boolean {
  return typeof query === 'function'
    || (typeof query === 'object'
      && query !== null
      && typeof (query as { run?: unknown }).run === 'function');
}

export function getDeploymentRuntimeEntrypoints(input: unknown): readonly string[] {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid API module: deployment build metadata is unavailable.');
  }
  const api = input as RuntimeApi;
  const source = api[deploymentBuildSourceSymbol];
  if (source?.version !== 1 || !Array.isArray(source.runtimeEntrypoints)) {
    throw new Error(
      'The exported API does not expose deployment build metadata. '
      + 'Upgrade @hypequery/serve before building runtime artifacts.',
    );
  }

  const names = source.runtimeEntrypoints.map((name) => {
    try {
      return parseProtocolIdentifier(name);
    } catch {
      throw new Error(`Invalid runtime entrypoint name: ${String(name)}`);
    }
  });
  if (new Set(names).size !== names.length) {
    throw new Error('Deployment build metadata contains duplicate runtime entrypoints.');
  }
  for (const name of names) {
    if (!executableQuery(api.queries?.[name]?.query)) {
      throw new Error(`Serve query "${name}" does not expose an executable runtime handler.`);
    }
  }
  return Object.freeze([...names].sort());
}

function projectRelativeImport(apiPath: string): { resolved: string; specifier: string } {
  const resolved = path.resolve(process.cwd(), apiPath);
  const relative = path.relative(process.cwd(), resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('The API module must be inside the current project for deterministic bundling.');
  }
  const portable = relative.split(path.sep).join('/');
  return {
    resolved,
    specifier: portable.startsWith('.') ? portable : `./${portable}`,
  };
}

function runtimeEntrySource(
  apiSpecifier: string,
  runtimeEntrypoints: readonly string[],
  entrypointPrefix: string,
): string {
  const prefix = parseProtocolQualifiedIdentifier(entrypointPrefix).split('.');
  const names = JSON.stringify(runtimeEntrypoints);
  let registryExpression = 'runtimeEntries';
  for (let index = prefix.length - 1; index >= 1; index -= 1) {
    registryExpression = `Object.freeze({ ${prefix[index]}: ${registryExpression} })`;
  }

  return [
    `import * as apiModule from ${JSON.stringify(apiSpecifier)};`,
    'const api = apiModule.api ?? Reflect.get(apiModule, "default");',
    'if (!api || typeof api !== "object") throw new Error("Runtime API export is unavailable.");',
    'const resolveQuery = (name) => {',
    '  const query = api.queries?.[name]?.query;',
    '  if (typeof query === "function") return query;',
    '  if (query && typeof query === "object" && typeof query.run === "function") {',
    '    return query.run.bind(query);',
    '  }',
    '  throw new Error(`Runtime entrypoint ${name} is unavailable.`);',
    '};',
    `const runtimeEntries = Object.freeze(Object.fromEntries(${names}.map(name => [name, resolveQuery(name)])));`,
    `export const ${prefix[0]} = ${registryExpression};`,
    '',
  ].join('\n');
}

export async function buildNodeRuntimeArtifact(
  apiPath: string,
  runtimeEntrypoints: readonly string[],
  entrypointPrefix = 'queries',
): Promise<NodeRuntimeArtifact> {
  if (runtimeEntrypoints.length === 0) {
    throw new Error('Cannot build a runtime artifact without Serve query entrypoints.');
  }
  const names = getValidatedEntrypointNames(runtimeEntrypoints);
  const { resolved, specifier } = projectRelativeImport(apiPath);
  let source: string;
  try {
    source = runtimeEntrySource(specifier, names, entrypointPrefix);
  } catch {
    throw new Error(`Invalid runtime entrypoint prefix: ${entrypointPrefix}`);
  }

  try {
    const result = await build({
      stdin: {
        contents: source,
        loader: 'ts',
        resolveDir: process.cwd(),
        sourcefile: 'hypequery-runtime-entry.ts',
      },
      absWorkingDir: process.cwd(),
      bundle: true,
      charset: 'utf8',
      format: 'esm',
      legalComments: 'none',
      logLevel: 'warning',
      minify: true,
      platform: 'node',
      sourcemap: false,
      target: ['node18'],
      treeShaking: true,
      tsconfig: await findNearestTsconfig(resolved) ?? undefined,
      write: false,
    });
    const output = result.outputFiles?.find(file => file.path.endsWith('.js'))
      ?? result.outputFiles?.[0];
    if (!output) throw new Error('esbuild produced no output');
    const bytes = output.contents;
    return Object.freeze({
      bytes,
      artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      entrypointPrefix,
      runtimeEntrypoints: names,
    });
  } catch (error) {
    throw new Error(
      `Failed to build the Node runtime artifact from ${apiPath}.\n`
      + `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getValidatedEntrypointNames(input: readonly string[]): readonly string[] {
  const names = input.map((name) => {
    try {
      return parseProtocolIdentifier(name);
    } catch {
      throw new Error(`Invalid runtime entrypoint name: ${name}`);
    }
  });
  if (new Set(names).size !== names.length) {
    throw new Error('Runtime entrypoint names must be unique.');
  }
  return Object.freeze([...names].sort());
}
