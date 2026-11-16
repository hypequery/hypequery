import { describe, expect, it, vi } from 'vitest';

const mockLoadModule = vi.hoisted(() => vi.fn());
vi.mock('./load-api.js', () => ({ loadModule: mockLoadModule }));

import { loadCloudPublication } from './load-cloud-publication.js';

const contract = { kind: 'hypequery-deployment', version: 2, datasets: [] };

describe('loadCloudPublication', () => {
  it('loads a bare publishToCloud export with no business context', async () => {
    mockLoadModule.mockResolvedValue({ cloud: contract });
    const loaded = await loadCloudPublication('analytics/cloud.ts');
    expect(loaded.contract).toBe(contract);
    expect(loaded.businessContext).toBeUndefined();
  });

  it('loads a publication envelope with validated business context', async () => {
    mockLoadModule.mockResolvedValue({
      cloud: {
        kind: 'hypequery-cloud-publication',
        version: 1,
        deployment: contract,
        businessContext: {
          kind: 'hypequery-business-context',
          version: 1,
          glossary: [{ term: ' active customer ', meaning: 'ordered in 30 days' }],
        },
      },
    });
    const loaded = await loadCloudPublication('analytics/cloud.ts');
    expect(loaded.contract).toBe(contract);
    expect(loaded.businessContext?.glossary).toEqual([
      { term: 'active customer', meaning: 'ordered in 30 days' },
    ]);
  });

  it('loads an envelope without business context', async () => {
    mockLoadModule.mockResolvedValue({
      default: { kind: 'hypequery-cloud-publication', version: 1, deployment: contract },
    });
    await expect(loadCloudPublication('analytics/cloud.ts'))
      .resolves.toEqual({ contract });
  });

  it('names the source file when business context is invalid', async () => {
    mockLoadModule.mockResolvedValue({
      cloud: {
        kind: 'hypequery-cloud-publication',
        version: 1,
        deployment: contract,
        businessContext: { kind: 'hypequery-business-context', version: 1, memory: 'chat' },
      },
    });
    await expect(loadCloudPublication('analytics/cloud.ts')).rejects.toThrow(
      /Invalid business context in analytics\/cloud\.ts[\s\S]*\$\.memory/,
    );
  });

  it('rejects an envelope whose deployment is not a Cloud contract', async () => {
    mockLoadModule.mockResolvedValue({
      cloud: { kind: 'hypequery-cloud-publication', version: 1, deployment: {} },
    });
    await expect(loadCloudPublication('analytics/cloud.ts'))
      .rejects.toThrow('`deployment` must be the result of `publishToCloud');
  });

  it('rejects envelope versions this CLI does not understand', async () => {
    mockLoadModule.mockResolvedValue({
      cloud: { kind: 'hypequery-cloud-publication', version: 2, deployment: contract },
    });
    await expect(loadCloudPublication('analytics/cloud.ts'))
      .rejects.toThrow('Upgrade @hypequery/cli');
  });

  it('does not compile a Serve API implicitly', async () => {
    mockLoadModule.mockResolvedValue({ api: { deploymentContract: vi.fn() } });
    await expect(loadCloudPublication('analytics/api.ts')).rejects.toThrow(
      'A Serve API is not a Cloud publication.',
    );
  });
});
