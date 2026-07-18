import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNodeRuntimeArtifact,
  getDeploymentRuntimeEntrypoints,
} from './deployment-runtime-artifact.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(dirname, '..', '..', 'test-fixtures');
const fixture = path.join(fixtures, 'runtime-api.ts');
const serveFixture = path.join(fixtures, 'runtime-serve-api.ts');
const buildSourceSymbol = Symbol.for('hypequery.deployment-build-source.v1');

function sourceApi(names: readonly string[], queries: Record<string, unknown>) {
  const api = { queries } as Record<PropertyKey, unknown>;
  Object.defineProperty(api, buildSourceSymbol, {
    value: { version: 1, runtimeEntrypoints: names },
  });
  return api;
}

describe('deployment runtime artifacts', () => {
  it('reads, validates, and sorts Serve build entrypoints', () => {
    const api = sourceApi(['wrapped', 'greeting'], {
      greeting: { query: async () => 'hello' },
      wrapped: { query: { run: async () => 'welcome' } },
    });

    expect(getDeploymentRuntimeEntrypoints(api)).toEqual(['greeting', 'wrapped']);
    expect(Object.isFrozen(getDeploymentRuntimeEntrypoints(api))).toBe(true);
  });

  it('fails when internal build metadata points at a non-executable query', () => {
    const api = sourceApi(['missing'], { missing: { query: undefined } });
    expect(() => getDeploymentRuntimeEntrypoints(api)).toThrow(
      /Serve query "missing" does not expose an executable runtime handler/,
    );
  });

  it('builds deterministic executable Node artifacts', async () => {
    const first = await buildNodeRuntimeArtifact(fixture, ['wrapped', 'greeting']);
    const second = await buildNodeRuntimeArtifact(fixture, ['greeting', 'wrapped']);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.artifactSha256).toBe(second.artifactSha256);
    expect(first.artifactSha256).toBe(
      createHash('sha256').update(first.bytes).digest('hex'),
    );

    const encoded = Buffer.from(first.bytes).toString('base64');
    const runtime = await import(`data:text/javascript;base64,${encoded}`);
    await expect(runtime.queries.greeting({ input: { name: 'Ada' } })).resolves.toBe('Hello Ada');
    await expect(runtime.queries.wrapped({ input: { name: 'Lin' } })).resolves.toBe('Welcome Lin');
    expect(runtime.queries.semantic).toBeUndefined();
  });

  it('supports qualified entrypoint prefixes', async () => {
    const artifact = await buildNodeRuntimeArtifact(fixture, ['greeting'], 'handlers.v1');
    const encoded = Buffer.from(artifact.bytes).toString('base64');
    const runtime = await import(`data:text/javascript;base64,${encoded}`);

    await expect(runtime.handlers.v1.greeting({ input: { name: 'Ada' } }))
      .resolves.toBe('Hello Ada');
  });

  it('bundles executable handlers from a real Serve API module', async () => {
    const artifact = await buildNodeRuntimeArtifact(serveFixture, ['greeting']);
    const encoded = Buffer.from(artifact.bytes).toString('base64');
    const runtime = await import(`data:text/javascript;base64,${encoded}`);

    await expect(runtime.queries.greeting({ input: { name: 'Ada' } }))
      .resolves.toBe('Hello Ada');
  });
});
