import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareProtocolDeploymentContract } from '@hypequery/protocol';

const mockLoadApiModule = vi.hoisted(() => vi.fn());
const mockBuildNodeRuntimeArtifact = vi.hoisted(() => vi.fn());
const mockGetDeploymentRuntimeEntrypoints = vi.hoisted(() => vi.fn());

vi.mock('../utils/load-api.js', () => ({
  loadApiModule: mockLoadApiModule,
}));

vi.mock('../utils/deployment-runtime-artifact.js', () => ({
  buildNodeRuntimeArtifact: mockBuildNodeRuntimeArtifact,
  getDeploymentRuntimeEntrypoints: mockGetDeploymentRuntimeEntrypoints,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildDeploymentCommand, validateDeploymentCommand } from './deployment.js';

const ARTIFACT_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const contract = {
  kind: 'hypequery-deployment' as const,
  version: 1 as const,
  datasets: [],
  queries: [],
  artifacts: [],
};

describe('deployment commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue([]);
  });

  it('builds canonical deployment JSON and a domain-separated identity sidecar', async () => {
    const deploymentContract = vi.fn(() => contract);
    mockLoadApiModule.mockResolvedValue({ deploymentContract });
    const prepared = prepareProtocolDeploymentContract(contract);

    await buildDeploymentCommand('analytics/api.ts', {
      output: 'dist/deployment.json',
      runtimeArtifact: ARTIFACT_SHA,
      entrypointPrefix: 'handlers',
    });

    expect(deploymentContract).toHaveBeenCalledWith({
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
        entrypointPrefix: 'handlers',
      },
    });
    expect(mkdir).toHaveBeenCalledWith('dist', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      'dist/deployment.json',
      `${prepared.canonical}\n`,
      'utf8',
    );
    expect(writeFile).toHaveBeenCalledWith(
      'dist/deployment.json.sha256',
      '# Hypequery deployment identity v1; not a file checksum or sha256sum input.\n'
      + '# SHA-256(UTF-8("hypequery:deployment:v1") || 0x00 || RFC 8785 canonical bytes); '
      + 'the output newline is excluded.\n'
      + `${prepared.identity}  deployment.json\n`,
      'utf8',
    );
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
  });

  it('bundles Node handlers and wires their digest into the deployment contract', async () => {
    const deploymentContract = vi.fn(() => contract);
    const bytes = new TextEncoder().encode('export const queries = {};\n');
    mockLoadApiModule.mockResolvedValue({ deploymentContract });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);
    mockBuildNodeRuntimeArtifact.mockResolvedValue({
      bytes,
      artifactSha256: ARTIFACT_SHA,
      entrypointPrefix: 'queries',
      runtimeEntrypoints: ['greeting'],
    });

    await buildDeploymentCommand('analytics/api.ts', {
      output: 'dist/deployment.json',
      runtimeOutput: 'dist/runtime.mjs',
    });

    expect(mockBuildNodeRuntimeArtifact).toHaveBeenCalledWith(
      'analytics/api.ts',
      ['greeting'],
      undefined,
    );
    expect(deploymentContract).toHaveBeenCalledWith({
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
        entrypointPrefix: 'queries',
      },
    });
    expect(writeFile).toHaveBeenCalledWith('dist/runtime.mjs', bytes);
  });

  it('rejects malformed runtime artifact identities before loading the API', async () => {
    await expect(buildDeploymentCommand('analytics/api.ts', {
      runtimeArtifact: 'not-a-sha',
    })).rejects.toThrow(/64-character SHA-256/);
    expect(mockLoadApiModule).not.toHaveBeenCalled();
  });

  it('requires an API with deployment contract support', async () => {
    mockLoadApiModule.mockResolvedValue({ handler: vi.fn() });
    await expect(buildDeploymentCommand('analytics/api.ts')).rejects.toThrow(
      /must provide deploymentContract\(\)/,
    );
  });

  it('requires a prebuilt artifact for Python handlers', async () => {
    mockLoadApiModule.mockResolvedValue({ deploymentContract: vi.fn() });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);

    await expect(buildDeploymentCommand('analytics/api.ts', { runtime: 'python' }))
      .rejects.toThrow(/support Node only[\s\S]*--runtime-artifact/);
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
  });

  it('rejects runtime output paths that overwrite deployment metadata', async () => {
    mockLoadApiModule.mockResolvedValue({ deploymentContract: vi.fn(() => contract) });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);
    mockBuildNodeRuntimeArtifact.mockResolvedValue({
      bytes: new Uint8Array(),
      artifactSha256: ARTIFACT_SHA,
      entrypointPrefix: 'queries',
      runtimeEntrypoints: ['greeting'],
    });

    await expect(buildDeploymentCommand('analytics/api.ts', {
      output: 'dist/deployment.json',
      runtimeOutput: 'dist/deployment.json',
    })).rejects.toThrow(/--runtime-output must use a different path from --output/);
    expect(mockLoadApiModule).not.toHaveBeenCalled();
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('does not emit a runtime artifact for Dataset-only APIs', async () => {
    const deploymentContract = vi.fn(() => contract);
    mockLoadApiModule.mockResolvedValue({ deploymentContract });

    await buildDeploymentCommand('analytics/api.ts', { output: 'dist/deployment.json' });

    expect(deploymentContract).toHaveBeenCalledWith({});
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining('runtime'),
      expect.anything(),
    );
  });

  it('validates an artifact and returns its immutable contract', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(contract));

    const result = await validateDeploymentCommand('dist/deployment.json');

    expect(result).toEqual(contract);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('reports malformed JSON separately from contract validation', async () => {
    vi.mocked(readFile).mockResolvedValue('{');
    await expect(validateDeploymentCommand('broken.json')).rejects.toThrow(
      /Invalid deployment JSON: broken\.json/,
    );
  });

  it('includes the artifact path in contract validation errors', async () => {
    vi.mocked(readFile).mockResolvedValue('{}');
    await expect(validateDeploymentCommand('invalid.json')).rejects.toThrow(
      /Invalid deployment contract: invalid\.json[\s\S]*HQ_DEPLOYMENT_/,
    );
  });
});
