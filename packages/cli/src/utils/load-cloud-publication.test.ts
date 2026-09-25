import { describe, expect, it, vi } from 'vitest';

const mockLoadModule = vi.hoisted(() => vi.fn());
vi.mock('./load-api.js', () => ({ loadModule: mockLoadModule }));

import { loadCloudPublication } from './load-cloud-publication.js';

describe('loadCloudPublication', () => {
  it('loads an explicit cloud export', async () => {
    const cloud = { kind: 'hypequery-deployment', version: 2, datasets: [] };
    mockLoadModule.mockResolvedValue({ cloud });
    await expect(loadCloudPublication('analytics/cloud.ts')).resolves.toBe(cloud);
  });

  it('does not compile a Serve API implicitly', async () => {
    mockLoadModule.mockResolvedValue({ api: { deploymentContract: vi.fn() } });
    await expect(loadCloudPublication('analytics/api.ts')).rejects.toThrow(
      'A Serve API is not a Cloud publication.',
    );
  });
});
