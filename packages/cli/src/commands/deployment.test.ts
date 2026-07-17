import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeProtocolDeploymentContractToString,
  hashProtocolDeploymentContract,
} from '@hypequery/protocol';

const mockLoadApiModule = vi.hoisted(() => vi.fn());

vi.mock('../utils/load-api.js', () => ({
  loadApiModule: mockLoadApiModule,
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
  });

  it('builds canonical deployment JSON and a domain-separated identity sidecar', async () => {
    const deploymentContract = vi.fn(() => contract);
    mockLoadApiModule.mockResolvedValue({ deploymentContract });

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
      `${encodeProtocolDeploymentContractToString(contract)}\n`,
      'utf8',
    );
    expect(writeFile).toHaveBeenCalledWith(
      'dist/deployment.json.sha256',
      `${hashProtocolDeploymentContract(contract)}  deployment.json\n`,
      'utf8',
    );
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
});
