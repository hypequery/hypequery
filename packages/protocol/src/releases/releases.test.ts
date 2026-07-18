import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  encodeProtocolDeploymentReleaseEnvelope,
  encodeProtocolDeploymentReleaseEnvelopeToString,
  hashProtocolDeploymentReleaseEnvelope,
  prepareProtocolDeploymentReleaseEnvelope,
  PROTOCOL_DEPLOYMENT_RELEASE_IDENTITY_DOMAIN,
  ProtocolDeploymentReleaseError,
  validateProtocolDeploymentReleaseEnvelope,
} from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture { id: string; generator: { type: string }; error: string }
interface IdentityFixture { id: string; canonical: string; sha256: string }

const FAILURE_CODES = [
  'HQ_RELEASE_TYPE',
  'HQ_RELEASE_UNKNOWN_FIELD',
  'HQ_RELEASE_INVALID_VERSION',
  'HQ_RELEASE_INVALID_VALUE',
  'HQ_RELEASE_TOO_LARGE',
  'HQ_RELEASE_UNSAFE_OBJECT',
] as const;

function readFixture<T>(name: string): T {
  const fixturePath = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/deployment-releases-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

function baseRelease() {
  return {
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: '0'.repeat(64),
    target: { project: 'project_1', environment: 'production' },
  };
}

function materialize(type: string): unknown {
  const value = baseRelease();
  switch (type) {
    case 'wrong-root-type': return [];
    case 'unknown-root-field': return { ...value, extra: true };
    case 'unsupported-version': return { ...value, version: 2 };
    case 'malformed-bundle-identity': return { ...value, bundleIdentity: 'bad' };
    case 'target-too-large': return {
      ...value,
      target: { ...value.target, project: `p${'a'.repeat(128)}` },
    };
    case 'unsafe-accessor': {
      const unsafe = baseRelease() as Record<string, unknown>;
      Object.defineProperty(unsafe, 'kind', {
        enumerable: true,
        get: () => 'hypequery-deployment-release',
      });
      return unsafe;
    }
    default: throw new Error(`Unknown fixture generator: ${type}`);
  }
}

function expectReleaseError(action: () => unknown, code: string, path?: string): void {
  try {
    action();
    throw new Error('Expected release validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolDeploymentReleaseError);
    expect((error as ProtocolDeploymentReleaseError).code).toBe(code);
    if (path !== undefined) expect((error as ProtocolDeploymentReleaseError).path).toBe(path);
  }
}

describe('deployment release envelope v1', () => {
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
    const release = validateProtocolDeploymentReleaseEnvelope(value);
    expect(release).toEqual(value);
    expect(Object.isFrozen(release)).toBe(true);
    expect(Object.isFrozen(release.target)).toBe(true);
  });

  it.each(identities)('$id matches canonical bytes and identity', fixture => {
    const value = success.find(candidate => candidate.id === fixture.id)?.value;
    expect(value).toBeDefined();
    const prepared = prepareProtocolDeploymentReleaseEnvelope(value);
    expect(prepared.canonical).toBe(fixture.canonical);
    expect(new TextDecoder().decode(prepared.bytes)).toBe(fixture.canonical);
    expect(prepared.identity).toBe(fixture.sha256);
    expect(Object.isFrozen(prepared)).toBe(true);
  });

  it('produces canonical bytes and a domain-separated identity', () => {
    const release = baseRelease();
    const canonical = encodeProtocolDeploymentReleaseEnvelopeToString(release);
    expect(new TextDecoder().decode(encodeProtocolDeploymentReleaseEnvelope(release)))
      .toBe(canonical);
    expect(hashProtocolDeploymentReleaseEnvelope(release)).toBe(
      createHash('sha256')
        .update(PROTOCOL_DEPLOYMENT_RELEASE_IDENTITY_DOMAIN)
        .update(canonical)
        .digest('hex'),
    );
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    expectReleaseError(
      () => validateProtocolDeploymentReleaseEnvelope(materialize(fixture.generator.type)),
      fixture.error,
    );
  });

  it('rejects whitespace and control characters in target tokens', () => {
    expectReleaseError(
      () => validateProtocolDeploymentReleaseEnvelope({
        ...baseRelease(),
        target: { project: 'project 1', environment: 'production' },
      }),
      'HQ_RELEASE_INVALID_VALUE',
      '$.target.project',
    );
  });

  it('skips explicit undefined limits and rejects raised limits', () => {
    expect(() => validateProtocolDeploymentReleaseEnvelope(baseRelease(), {
      limits: { maxTargetBytes: undefined },
    })).not.toThrow();
    expect(() => validateProtocolDeploymentReleaseEnvelope(baseRelease(), {
      limits: { maxTargetBytes: 129 },
    })).toThrow(/deployment release v1 maximum/);
  });
});
