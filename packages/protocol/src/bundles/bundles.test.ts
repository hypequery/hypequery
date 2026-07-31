import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  encodeProtocolDeploymentBundleManifest,
  encodeProtocolDeploymentBundleManifestToString,
  hashProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentBundleManifest,
  PROTOCOL_DEPLOYMENT_BUNDLE_IDENTITY_DOMAIN,
  ProtocolDeploymentBundleError,
  validateProtocolDeploymentBundleManifest,
} from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture { id: string; generator: { type: string }; error: string }
interface IdentityFixture { id: string; canonical: string; sha256: string }

const FAILURE_CODES = [
  'HQ_BUNDLE_TYPE',
  'HQ_BUNDLE_UNKNOWN_FIELD',
  'HQ_BUNDLE_INVALID_VERSION',
  'HQ_BUNDLE_INVALID_VALUE',
  'HQ_BUNDLE_INVALID_PATH',
  'HQ_BUNDLE_INVALID_REFERENCE',
  'HQ_BUNDLE_TOO_MANY_ITEMS',
  'HQ_BUNDLE_TOO_LARGE',
  'HQ_BUNDLE_UNSAFE_OBJECT',
] as const;

function readFixture<T>(name: string): T {
  const fixturePath = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/deployment-bundles-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

function artifact(index = 0) {
  const sha256 = index.toString(16).padStart(64, '0');
  return {
    runtime: 'node',
    path: `artifacts/${sha256}.mjs`,
    sha256,
    byteLength: 1,
  };
}

function baseManifest() {
  return {
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: {
      path: 'deployment.json',
      identity: '1'.repeat(64),
      sha256: '2'.repeat(64),
      byteLength: 1,
    },
    artifacts: [artifact()],
  };
}

function source() {
  return {
    root: 'source',
    entrypoint: 'analytics/api.ts',
    files: [
      {
        path: 'analytics/api.ts',
        sha256: '3'.repeat(64),
        byteLength: 20,
      },
      {
        path: 'analytics/datasets/orders.ts',
        sha256: '4'.repeat(64),
        byteLength: 40,
      },
    ],
    revision: {
      kind: 'git',
      commit: '5'.repeat(40),
      dirty: false,
      branch: 'feature/customer-retention',
    },
  };
}

function materialize(type: string): unknown {
  const value = baseManifest();
  switch (type) {
    case 'wrong-root-type': return [];
    case 'unknown-root-field': return { ...value, extra: true };
    case 'unsupported-version': return { ...value, version: 2 };
    case 'malformed-digest': return { ...value, deployment: { ...value.deployment, identity: 'bad' } };
    case 'traversal-path': return { ...value, deployment: { ...value.deployment, path: '../deployment.json' } };
    case 'duplicate-path': return {
      ...value,
      artifacts: [{ ...artifact(), path: value.deployment.path }],
    };
    case 'too-many-artifacts': return {
      ...value,
      artifacts: Array.from({ length: 101 }, (_, index) => artifact(index)),
    };
    case 'deployment-too-large': return {
      ...value,
      deployment: { ...value.deployment, byteLength: (16 * 1024 * 1024) + 1 },
    };
    case 'unsafe-accessor': {
      const unsafe = baseManifest() as Record<string, unknown>;
      Object.defineProperty(unsafe, 'kind', {
        enumerable: true,
        get: () => 'hypequery-deployment-bundle',
      });
      return unsafe;
    }
    default: throw new Error(`Unknown fixture generator: ${type}`);
  }
}

function expectBundleError(action: () => unknown, code: string, path?: string): void {
  try {
    action();
    throw new Error('Expected bundle validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolDeploymentBundleError);
    expect((error as ProtocolDeploymentBundleError).code).toBe(code);
    if (path !== undefined) expect((error as ProtocolDeploymentBundleError).path).toBe(path);
  }
}

describe('deployment bundle manifest v1', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');
  const identities = readFixture<IdentityFixture[]>('identity.json');

  it('has unique fixtures and covers every stable error code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id as an immutable snapshot', ({ value }) => {
    const manifest = validateProtocolDeploymentBundleManifest(value);
    expect(manifest).toEqual(value);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.deployment)).toBe(true);
    expect(Object.isFrozen(manifest.artifacts)).toBe(true);
    expect(Object.isFrozen(manifest.artifacts[0])).toBe(true);
  });

  it.each(identities)('$id matches canonical bytes and identity', fixture => {
    const value = success.find(candidate => candidate.id === fixture.id)?.value;
    expect(value).toBeDefined();
    const prepared = prepareProtocolDeploymentBundleManifest(value);
    expect(prepared.canonical).toBe(fixture.canonical);
    expect(new TextDecoder().decode(prepared.bytes)).toBe(fixture.canonical);
    expect(prepared.identity).toBe(fixture.sha256);
    expect(Object.isFrozen(prepared)).toBe(true);
  });

  it('produces canonical bytes and a domain-separated identity', () => {
    const manifest = baseManifest();
    const canonical = encodeProtocolDeploymentBundleManifestToString(manifest);
    expect(new TextDecoder().decode(encodeProtocolDeploymentBundleManifest(manifest)))
      .toBe(canonical);
    expect(hashProtocolDeploymentBundleManifest(manifest)).toBe(
      createHash('sha256')
        .update(PROTOCOL_DEPLOYMENT_BUNDLE_IDENTITY_DOMAIN)
        .update(canonical)
        .digest('hex'),
    );
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    expectBundleError(
      () => validateProtocolDeploymentBundleManifest(materialize(fixture.generator.type)),
      fixture.error,
    );
  });

  it('rejects unsorted artifact paths', () => {
    const value = { ...baseManifest(), artifacts: [artifact(2), artifact(1)] };
    expectBundleError(
      () => validateProtocolDeploymentBundleManifest(value),
      'HQ_BUNDLE_INVALID_VALUE',
      '$.artifacts',
    );
  });

  it('accepts an immutable multi-file source snapshot', () => {
    const manifest = validateProtocolDeploymentBundleManifest({
      ...baseManifest(),
      source: source(),
    });
    expect(manifest.source).toEqual(source());
    expect(Object.isFrozen(manifest.source)).toBe(true);
    expect(Object.isFrozen(manifest.source?.files)).toBe(true);
    expect(Object.isFrozen(manifest.source?.files[0])).toBe(true);
    expect(Object.isFrozen(manifest.source?.revision)).toBe(true);
  });

  it('accepts detached revisions and rejects invalid branch provenance', () => {
    const detached = source();
    delete (detached.revision as { branch?: string }).branch;
    expect(validateProtocolDeploymentBundleManifest({
      ...baseManifest(),
      source: detached,
    }).source?.revision).toEqual(detached.revision);

    expectBundleError(
      () => validateProtocolDeploymentBundleManifest({
        ...baseManifest(),
        source: {
          ...source(),
          revision: { ...source().revision, branch: 'feature/../production' },
        },
      }),
      'HQ_BUNDLE_INVALID_VALUE',
      '$.source.revision.branch',
    );
  });

  it('requires the source entrypoint and a collision-free bundle tree', () => {
    expectBundleError(
      () => validateProtocolDeploymentBundleManifest({
        ...baseManifest(),
        source: { ...source(), entrypoint: 'analytics/missing.ts' },
      }),
      'HQ_BUNDLE_INVALID_REFERENCE',
      '$.source.entrypoint',
    );
    expectBundleError(
      () => validateProtocolDeploymentBundleManifest({
        ...baseManifest(),
        deployment: { ...baseManifest().deployment, path: 'source' },
        source: source(),
      }),
      'HQ_BUNDLE_INVALID_REFERENCE',
      '$',
    );
  });

  it('rejects hidden array properties and platform-ambiguous paths', () => {
    const hidden = baseManifest();
    Object.defineProperty(hidden.artifacts, 'hidden', { value: true });
    expectBundleError(
      () => validateProtocolDeploymentBundleManifest(hidden),
      'HQ_BUNDLE_UNSAFE_OBJECT',
      '$.artifacts',
    );
    expectBundleError(
      () => validateProtocolDeploymentBundleManifest({
        ...baseManifest(),
        deployment: { ...baseManifest().deployment, path: 'CON.json' },
      }),
      'HQ_BUNDLE_INVALID_PATH',
      '$.deployment.path',
    );
  });

  it('skips explicit undefined limits and rejects raised limits', () => {
    expect(() => validateProtocolDeploymentBundleManifest(baseManifest(), {
      limits: { maxArtifacts: undefined },
    })).not.toThrow();
    expect(() => validateProtocolDeploymentBundleManifest(baseManifest(), {
      limits: { maxArtifacts: 101 },
    })).toThrow(/deployment bundle v1 maximum/);
  });
});
