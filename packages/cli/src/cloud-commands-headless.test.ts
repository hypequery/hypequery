import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareProtocolDeploymentReleaseEnvelope } from '@hypequery/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * AG-08: every command that talks to Cloud gets its credential from the one
 * resolver, so with HYPEQUERY_API_TOKEN set it runs headless: no terminal, no
 * prompt, no browser, and no stored sign-in read.
 */

const mockVerifyDeploymentBundle = vi.hoisted(() => vi.fn());
vi.mock('./utils/deployment-bundle.js', () => ({
  verifyDeploymentBundle: mockVerifyDeploymentBundle,
  DEPLOYMENT_BUNDLE_MANIFEST: 'bundle.json',
}));
vi.mock('./utils/logger.js', () => ({
  logger: { success: vi.fn(), info: vi.fn(), warn: vi.fn(), newline: vi.fn(), indent: vi.fn() },
}));
vi.mock('open', () => ({
  default: vi.fn(() => {
    throw new Error('no command may open a browser headless');
  }),
}));

import { deployCommand, submitDeploymentCommand } from './commands/deploy.js';
import { deploymentStatusCommand } from './commands/deployment-status.js';
import { diffCommand, pullCommand } from './commands/live-source.js';
import { generateClientCommand } from './commands/generate-client.js';
import { setUnattended } from './utils/input-mode.js';

const TOKEN = `hqmt_v1_${'h'.repeat(43)}`;
const ENDPOINT = 'https://cloud.hypequery.com/v1/deployments/submissions';
const TARGET = { project: 'acme:shop', environment: 'production' };
const BUNDLE_IDENTITY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const env = { HYPEQUERY_API_TOKEN: TOKEN };

let directory: string;
let releasePath: string;
const stdinTty = process.stdin.isTTY;

/** The stored sign-ins must never be read when the variable is set. */
function headless() {
  return {
    env,
    loadCredential: vi.fn(async () => {
      throw new Error('stored browser sign-in read');
    }),
    loadManagementCredential: vi.fn(async () => {
      throw new Error('stored management token read');
    }),
  };
}

function liveState() {
  return vi.fn(async (input: { endpoint: string; token: string }) => {
    expect(input).toMatchObject({ endpoint: ENDPOINT, token: TOKEN });
    return { active: null };
  });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'hypequery-headless-test-'));
  releasePath = path.join(directory, 'release.json');
  const release = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: BUNDLE_IDENTITY,
    target: TARGET,
  });
  await writeFile(releasePath, `${release.canonical}\n`, 'utf8');
  mockVerifyDeploymentBundle.mockResolvedValue({
    directory: path.join(directory, 'bundle'),
    manifest: {},
    identity: BUNDLE_IDENTITY,
    contract: { kind: 'hypequery-deployment', version: 2, datasets: [] },
  });
  // No terminal, and --no-input.
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  setUnattended(true, {});
});

afterAll(async () => {
  setUnattended(false, {});
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinTty, configurable: true });
  await rm(directory, { force: true, recursive: true });
});

afterEach(() => vi.clearAllMocks());

function transport() {
  const submit = vi.fn(async () => ({
    kind: 'hypequery-deployment-submission',
    version: 1,
    status: 'accepted',
    releaseIdentity: '1'.repeat(64),
    bundleIdentity: BUNDLE_IDENTITY,
  }));
  return { submit, createTransport: vi.fn(() => ({ submit })) };
}

describe('Cloud commands with HYPEQUERY_API_TOKEN and no terminal', () => {
  it('deployment:submit', async () => {
    const dependencies = headless();
    const { createTransport } = transport();
    await submitDeploymentCommand(path.join(directory, 'bundle'), { release: releasePath }, {
      ...dependencies,
      createTransport: createTransport as never,
      fetchLive: liveState() as never,
      fetchEndpoints: vi.fn(async () => undefined),
    });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ endpoint: ENDPOINT, token: TOKEN }));
    expect(dependencies.loadCredential).not.toHaveBeenCalled();
    expect(dependencies.loadManagementCredential).not.toHaveBeenCalled();
  });

  it('deploy', async () => {
    const dependencies = headless();
    const { createTransport } = transport();
    await deployCommand('analytics/cloud.ts', {
      project: TARGET.project,
      environment: TARGET.environment,
      releaseOutput: releasePath,
    }, {
      ...dependencies,
      buildDeployment: vi.fn(async () => ({}) as never),
      prepareDeploymentRelease: vi.fn(async () => ({}) as never),
      createTransport: createTransport as never,
      fetchLive: liveState() as never,
      fetchEndpoints: vi.fn(async () => undefined),
    });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ endpoint: ENDPOINT, token: TOKEN }));
    expect(dependencies.loadCredential).not.toHaveBeenCalled();
    expect(dependencies.loadManagementCredential).not.toHaveBeenCalled();
  });

  it('deployment:status', async () => {
    const dependencies = headless();
    const fetchLive = liveState();
    const fetchEndpoints = vi.fn(async (input: { endpoint: string; token: string }) => {
      expect(input).toMatchObject({ endpoint: ENDPOINT, token: TOKEN });
      return undefined;
    });
    await deploymentStatusCommand(
      { project: TARGET.project, environment: TARGET.environment },
      { ...dependencies, fetchLive: fetchLive as never, fetchEndpoints },
    );
    expect(fetchLive).toHaveBeenCalledWith(expect.objectContaining({ target: TARGET }));
    expect(fetchEndpoints).toHaveBeenCalled();
    expect(dependencies.loadManagementCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['pull', () => pullCommand],
    ['diff', () => diffCommand],
  ] as const)('%s', async (_name, command) => {
    const dependencies = headless();
    const fetchLive = liveState();
    const run = command() as (...args: unknown[]) => Promise<unknown>;
    const args = _name === 'pull'
      ? [{ project: TARGET.project, environment: TARGET.environment, output: path.join(directory, 'pulled') }]
      : [undefined, { project: TARGET.project, environment: TARGET.environment }];
    // The stub Cloud has no live source; reaching it is what matters here.
    await expect(run(...args, { ...dependencies, fetchLive })).rejects.toThrow(/source snapshot/);
    expect(fetchLive).toHaveBeenCalledWith(expect.objectContaining({ resource: 'source', target: TARGET }));
    expect(dependencies.loadManagementCredential).not.toHaveBeenCalled();
  });

  it('generate:client --cloud', async () => {
    const dependencies = headless();
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toMatch(/^https:\/\/cloud\.hypequery\.com\/v1\/deployments\/targets\/.+\/client-contract$/);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      return new Response(null, { status: 404 });
    });
    await expect(generateClientCommand(undefined, {
      cloud: true,
      project: TARGET.project,
      environment: TARGET.environment,
    }, {
      ...dependencies,
      fetch: fetch as typeof globalThis.fetch,
      fetchEndpoints: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetch).toHaveBeenCalled();
    expect(dependencies.loadManagementCredential).not.toHaveBeenCalled();
  });
});
