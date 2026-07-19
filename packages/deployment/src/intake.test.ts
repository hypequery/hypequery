import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentContract,
  prepareProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeploymentIntake } from './intake.js';
import type {
  DeploymentIntakeRequest,
  DeploymentSubmissionStore,
} from './types.js';

interface Part {
  readonly name: 'release' | 'bundle';
  readonly filename: string;
  readonly contentType: string;
  readonly bundlePath?: string;
  readonly bytes: Uint8Array;
}

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-intake-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function multipart(boundary: string, parts: readonly Part[]): Buffer {
  const values: Buffer[] = [];
  for (const part of parts) {
    values.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`,
      `Content-Type: ${part.contentType}`,
      ...(part.bundlePath ? [`X-HypeQuery-Bundle-Path: ${part.bundlePath}`] : []),
      '',
      '',
    ].join('\r\n')));
    values.push(Buffer.from(part.bytes), Buffer.from('\r\n'));
  }
  values.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(values);
}

async function* chunks(bytes: Uint8Array, size = 17): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}

function deployment() {
  return {
    kind: 'hypequery-deployment' as const,
    version: 1 as const,
    datasets: [],
    queries: [],
    artifacts: [],
  };
}

function submissionFixture(
  extraParts: readonly Part[] = [],
  deploymentPath = 'deployment.json',
) {
  const preparedDeployment = prepareProtocolDeploymentContract(deployment());
  const deploymentBytes = Buffer.from(`${preparedDeployment.canonical}\n`);
  const preparedManifest = prepareProtocolDeploymentBundleManifest({
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: {
      path: deploymentPath,
      identity: preparedDeployment.identity,
      sha256: sha256(deploymentBytes),
      byteLength: deploymentBytes.byteLength,
    },
    artifacts: [],
  });
  const release = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: preparedManifest.identity,
    target: { project: 'analytics', environment: 'production' },
  });
  const parts: Part[] = [
    {
      name: 'release',
      filename: 'release.json',
      contentType: 'application/json',
      bytes: release.bytes,
    },
    {
      name: 'bundle',
      filename: 'bundle.json',
      contentType: 'application/json',
      bundlePath: 'bundle.json',
      bytes: Buffer.from(`${preparedManifest.canonical}\n`),
    },
    {
      name: 'bundle',
      filename: path.basename(deploymentPath),
      contentType: 'application/json',
      bundlePath: deploymentPath,
      bytes: deploymentBytes,
    },
    ...extraParts,
  ];
  const boundary = 'hypequery-test-boundary';
  const body = multipart(boundary, parts);
  const request = (): DeploymentIntakeRequest => ({
    headers: {
      Authorization: 'Bearer secret-token',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.byteLength),
      'Idempotency-Key': release.identity,
      'X-HypeQuery-Release-Identity': release.identity,
      'X-HypeQuery-Bundle-Identity': preparedManifest.identity,
    },
    body: chunks(body),
  });
  return { body, boundary, deploymentBytes, preparedManifest, release, request };
}

function responseBody(response: { readonly body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

describe('deployment intake', () => {
  it('authenticates, authorizes, fully verifies, persists, and cleans the upload', async () => {
    const fixture = submissionFixture();
    const temporary = await temporaryDirectory();
    const authenticate = vi.fn(async () => 'principal');
    const authorize = vi.fn(async () => true);
    const accept = vi.fn<DeploymentSubmissionStore<string>['accept']>(async submission => {
      expect(submission.principal).toBe('principal');
      expect(submission.releaseCanonical).toBe(fixture.release.canonical);
      expect(submission.bundle.identity).toBe(fixture.preparedManifest.identity);
      expect(await readFile(
        path.join(submission.bundle.directory, 'deployment.json'),
      )).toEqual(fixture.deploymentBytes);
      return 'accepted';
    });
    const intake = createDeploymentIntake({
      authenticator: { authenticate },
      authorizer: { authorize },
      store: { accept },
      temporaryDirectory: temporary,
    });

    const response = await intake.handle(fixture.request());

    expect(response.status).toBe(202);
    expect(responseBody(response)).toEqual({
      kind: 'hypequery-deployment-submission',
      version: 1,
      status: 'accepted',
      releaseIdentity: fixture.release.identity,
      bundleIdentity: fixture.preparedManifest.identity,
    });
    expect(authenticate).toHaveBeenCalledWith({ token: 'secret-token', signal: undefined });
    expect(authorize).toHaveBeenCalledWith({
      principal: 'principal',
      target: { project: 'analytics', environment: 'production' },
      releaseIdentity: fixture.release.identity,
      bundleIdentity: fixture.preparedManifest.identity,
      signal: undefined,
    });
    expect(accept).toHaveBeenCalledOnce();
    expect(await readdir(temporary)).toEqual([]);
  });

  it('returns the store idempotency result after complete revalidation', async () => {
    const fixture = submissionFixture();
    const seen = new Set<string>();
    const accept = vi.fn<DeploymentSubmissionStore<string>['accept']>(async submission => {
      if (seen.has(submission.releaseIdentity)) return 'already-exists';
      seen.add(submission.releaseIdentity);
      return 'accepted';
    });
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept },
    });

    expect((responseBody(await intake.handle(fixture.request())) as { status: string }).status)
      .toBe('accepted');
    const replay = await intake.handle(fixture.request());
    expect(replay.status).toBe(200);
    expect((responseBody(replay) as { status: string }).status).toBe('already-exists');
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('rejects unauthenticated requests before consuming body bytes', async () => {
    let consumed = false;
    const fixture = submissionFixture();
    const request = fixture.request();
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => null },
      authorizer: { authorize: async () => true },
      store: { accept: async () => 'accepted' },
    });

    const response = await intake.handle({
      ...request,
      body: (async function* () {
        consumed = true;
        yield fixture.body;
      })(),
    });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(consumed).toBe(false);
  });

  it('authorizes the canonical target before receiving bundle files', async () => {
    const fixture = submissionFixture();
    const accept = vi.fn<DeploymentSubmissionStore<string>['accept']>();
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => false },
      store: { accept },
    });

    const response = await intake.handle(fixture.request());

    expect(response.status).toBe(403);
    expect(accept).not.toHaveBeenCalled();
  });

  it('rejects tampered file bytes and never calls the store', async () => {
    const fixture = submissionFixture();
    const tampered = Buffer.from(fixture.body);
    const location = tampered.indexOf(fixture.deploymentBytes);
    tampered[location] = tampered[location]! ^ 1;
    const request = fixture.request();
    const accept = vi.fn<DeploymentSubmissionStore<string>['accept']>();
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept },
    });

    const response = await intake.handle({
      ...request,
      headers: { ...request.headers, 'Content-Length': String(tampered.byteLength) },
      body: chunks(tampered),
    });

    expect(response.status).toBe(400);
    expect(responseBody(response)).toMatchObject({ error: { code: 'HQ_INTAKE_BAD_REQUEST' } });
    expect(accept).not.toHaveBeenCalled();
  });

  it('rejects undeclared parts and truncated bodies', async () => {
    const extra: Part = {
      name: 'bundle',
      filename: 'extra.bin',
      contentType: 'application/octet-stream',
      bundlePath: 'extra.bin',
      bytes: Buffer.from('extra'),
    };
    const withExtra = submissionFixture([extra]);
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept: async () => 'accepted' },
    });

    expect((await intake.handle(withExtra.request())).status).toBe(400);
    const fixture = submissionFixture();
    const request = fixture.request();
    const truncated = fixture.body.subarray(0, fixture.body.byteLength - 8);
    const response = await intake.handle({ ...request, body: chunks(truncated) });
    expect(response.status).toBe(400);
  });

  it('rejects a declared file that collides with the bundle manifest path', async () => {
    const fixture = submissionFixture([], 'bundle.json');
    const accept = vi.fn<DeploymentSubmissionStore<string>['accept']>();
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept },
    });

    const response = await intake.handle(fixture.request());

    expect(response.status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });

  it('preflights request limits without consuming the body', async () => {
    const fixture = submissionFixture();
    const request = fixture.request();
    let consumed = false;
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept: async () => 'accepted' },
      limits: { maxRequestBytes: fixture.body.byteLength - 1 },
    });

    const response = await intake.handle({
      ...request,
      body: (async function* () {
        consumed = true;
        yield fixture.body;
      })(),
    });

    expect(response.status).toBe(413);
    expect(consumed).toBe(false);
  });

  it('accepts explicitly undefined limits and rejects raised safety ceilings', () => {
    const options = {
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept: async () => 'accepted' as const },
    };
    expect(() => createDeploymentIntake({
      ...options,
      limits: { maxRequestBytes: undefined },
    })).not.toThrow();
    expect(() => createDeploymentIntake({
      ...options,
      limits: { maxRequestBytes: (258 * 1024 * 1024) + 1 },
    })).toThrow(/deployment intake v1 maximum/);
  });

  it('cleans temporary bytes when persistence fails without exposing the error', async () => {
    const fixture = submissionFixture();
    const temporary = await temporaryDirectory();
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async () => 'principal' },
      authorizer: { authorize: async () => true },
      store: { accept: async () => { throw new Error('database secret'); } },
      temporaryDirectory: temporary,
    });

    const response = await intake.handle(fixture.request());

    expect(response.status).toBe(500);
    expect(response.body).not.toContain('database secret');
    expect(await readdir(temporary)).toEqual([]);
  });
});
