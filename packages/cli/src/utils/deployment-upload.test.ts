import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  prepareProtocolDeploymentContract,
  prepareProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import { createDeploymentIntake } from '@hypequery/deployment';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  verifyDeploymentBundle,
  writeDeploymentBundle,
} from './deployment-bundle.js';
import {
  createHttpDeploymentUploadTransport,
  DeploymentUploadError,
  type DeploymentFetch,
  type DeploymentFetchInit,
} from './deployment-upload.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-upload-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

const deployment = {
  kind: 'hypequery-deployment' as const,
  version: 1 as const,
  datasets: [],
  queries: [],
  artifacts: [],
};

async function verifiedBundle() {
  const parent = await temporaryDirectory();
  const directory = path.join(parent, 'bundle');
  await writeDeploymentBundle(
    directory,
    prepareProtocolDeploymentContract(deployment),
    [],
  );
  return verifyDeploymentBundle(directory);
}

function releaseFor(bundleIdentity: string) {
  return prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity,
    target: { project: 'project-1', environment: 'production' },
  });
}

function submission(
  bundleIdentity: string,
  releaseIdentity: string,
  status: 'accepted' | 'already-exists' = 'accepted',
) {
  return {
    kind: 'hypequery-deployment-submission',
    version: 1,
    status,
    releaseIdentity,
    bundleIdentity,
  };
}

async function consumeBody(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function jsonResponse(input: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(input), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('deployment upload transport', () => {
  it('is wire-compatible with the provider-neutral deployment intake', async () => {
    const bundle = await verifiedBundle();
    const release = releaseFor(bundle.identity);
    const intake = createDeploymentIntake({
      authenticator: { authenticate: async ({ token }) => (
        token === 'secret-token' ? 'principal' : null
      ) },
      authorizer: { authorize: async ({ target }) => (
        target.project === 'project-1' && target.environment === 'production'
      ) },
      store: {
        accept: async submission => {
          expect(await readFile(
            path.join(submission.bundle.directory, 'deployment.json'),
            'utf8',
          )).toContain('hypequery-deployment');
          return 'accepted';
        },
      },
    });
    const fetch = vi.fn<DeploymentFetch>(async (_endpoint, init) => {
      const response = await intake.handle({
        headers: init.headers,
        body: init.body,
        signal: init.signal,
      });
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    });
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, release)).resolves.toEqual(
      submission(bundle.identity, release.identity),
    );
  });

  it('streams a verified bundle with authenticated identity headers', async () => {
    const bundle = await verifiedBundle();
    const release = releaseFor(bundle.identity);
    let request: DeploymentFetchInit | undefined;
    let requestBytes: Uint8Array | undefined;
    const fetch = vi.fn<DeploymentFetch>(async (_endpoint, init) => {
      request = init;
      requestBytes = await consumeBody(init.body);
      return jsonResponse(submission(bundle.identity, release.identity));
    });
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    const result = await transport.submit(bundle, release);

    expect(result).toEqual(submission(bundle.identity, release.identity));
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(request?.headers.Authorization).toBe('Bearer secret-token');
    expect(request?.headers['Idempotency-Key']).toBe(release.identity);
    expect(request?.headers['X-HypeQuery-Bundle-Identity']).toBe(bundle.identity);
    expect(request?.headers['X-HypeQuery-Release-Identity']).toBe(release.identity);
    expect(request?.headers['Content-Length']).toBe(String(requestBytes?.byteLength));
    expect(request?.duplex).toBe('half');
    expect(request?.redirect).toBe('error');
    const body = new TextDecoder().decode(requestBytes);
    expect(body).toContain('name="release"; filename="release.json"');
    expect(body).toContain('X-HypeQuery-Bundle-Path: bundle.json');
    expect(body).toContain('X-HypeQuery-Bundle-Path: deployment.json');
    expect(body).toContain(release.canonical);
    expect(body).toContain(await readFile(
      path.join(bundle.directory, 'deployment.json'),
      'utf8',
    ));
    expect(body).not.toContain('secret-token');
  });

  it('rejects a release for a different bundle before opening the network', async () => {
    const bundle = await verifiedBundle();
    const fetch = vi.fn<DeploymentFetch>();
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, releaseFor('0'.repeat(64))))
      .rejects.toMatchObject({ code: 'HQ_UPLOAD_IDENTITY_MISMATCH' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects bundle paths that cannot be safely encoded as multipart headers', async () => {
    const bundle = await verifiedBundle();
    const unsafeBundle = {
      ...bundle,
      manifest: {
        ...bundle.manifest,
        deployment: {
          ...bundle.manifest.deployment,
          path: 'deployment.json\r\nInjected: header',
        },
      },
    };
    const fetch = vi.fn<DeploymentFetch>();
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(unsafeBundle, releaseFor(bundle.identity))).rejects.toMatchObject({
      code: 'HQ_UPLOAD_BUNDLE_CHANGED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts when a streamed bundle entry changed after verification', async () => {
    const bundle = await verifiedBundle();
    const release = releaseFor(bundle.identity);
    await writeFile(path.join(bundle.directory, 'deployment.json'), 'tampered');
    const fetch = vi.fn<DeploymentFetch>(async (_endpoint, init) => {
      await consumeBody(init.body);
      return jsonResponse(submission(bundle.identity, release.identity));
    });
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, release))
      .rejects.toMatchObject({ code: 'HQ_UPLOAD_BUNDLE_CHANGED' });
  });

  it('requires a credential-free HTTPS endpoint and a header-safe token', () => {
    expect(() => createHttpDeploymentUploadTransport({
      endpoint: 'http://deploy.example.test/v1/releases',
      token: 'secret-token',
    })).toThrow(/HQ_UPLOAD_CONFIGURATION[\s\S]*HTTPS/);
    expect(() => createHttpDeploymentUploadTransport({
      endpoint: 'https://user:password@deploy.example.test/v1/releases',
      token: 'secret-token',
    })).toThrow(/HQ_UPLOAD_CONFIGURATION[\s\S]*credentials/);
    expect(() => createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token\nInjected: header',
    })).toThrow(/HQ_UPLOAD_CONFIGURATION[\s\S]*HYPEQUERY_API_TOKEN/);
    expect(() => createHttpDeploymentUploadTransport({
      endpoint: 'http://127.0.0.1:3000/v1/deployments/submissions',
      token: 'secret-token',
    })).not.toThrow();
  });

  it('returns a stable rejection with bounded server detail', async () => {
    const bundle = await verifiedBundle();
    const release = releaseFor(bundle.identity);
    const fetch = vi.fn<DeploymentFetch>(async (_endpoint, init) => {
      await consumeBody(init.body);
      return jsonResponse({
        error: { code: 'TARGET_FORBIDDEN', message: 'Project access denied\nretry later' },
      }, 403, 'Forbidden');
    });
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, release)).rejects.toMatchObject({
      code: 'HQ_UPLOAD_REJECTED',
      status: 403,
      message: expect.stringMatching(/TARGET_FORBIDDEN: Project access denied retry later/),
    });
  });

  it('rejects successful responses with mismatched identities or extra fields', async () => {
    const bundle = await verifiedBundle();
    const release = releaseFor(bundle.identity);
    const fetch = vi.fn<DeploymentFetch>(async (_endpoint, init) => {
      await consumeBody(init.body);
      return jsonResponse({
        ...submission(bundle.identity, '0'.repeat(64)),
        unexpected: true,
      });
    });
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, release)).rejects.toMatchObject({
      code: 'HQ_UPLOAD_INVALID_RESPONSE',
    });
  });

  it('preserves upload integrity errors wrapped by a fetch implementation', async () => {
    const error = new DeploymentUploadError('HQ_UPLOAD_BUNDLE_CHANGED', 'changed');
    let wrapped: unknown = error;
    for (let depth = 0; depth < 6; depth += 1) {
      wrapped = new TypeError(`fetch wrapper ${depth}`, { cause: wrapped });
    }
    const fetch = vi.fn<DeploymentFetch>(async () => {
      throw wrapped;
    });
    const bundle = await verifiedBundle();
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, releaseFor(bundle.identity))).rejects.toBe(error);
  });

  it('stops safely when a fetch error cause chain contains a cycle', async () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    const fetch = vi.fn<DeploymentFetch>(async () => { throw cyclic; });
    const bundle = await verifiedBundle();
    const transport = createHttpDeploymentUploadTransport({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
      fetch,
    });

    await expect(transport.submit(bundle, releaseFor(bundle.identity))).rejects.toMatchObject({
      code: 'HQ_UPLOAD_NETWORK',
    });
  });
});
