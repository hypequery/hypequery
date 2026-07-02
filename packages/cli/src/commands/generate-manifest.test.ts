import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';

const mockLoadApiModule = vi.hoisted(() => vi.fn());

vi.mock('../utils/load-api.js', () => ({
  loadApiModule: mockLoadApiModule,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    success: vi.fn(),
  },
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  };
});

describe('generate manifest command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads an API module and writes its serializable manifest JSON', async () => {
    const manifest = {
      revenue: { method: 'POST', path: '/api/analytics/metrics/revenue' },
      'dataset:orders': { method: 'POST', path: '/api/analytics/datasets/orders/query' },
    };
    mockLoadApiModule.mockResolvedValue({
      handler: () => undefined,
      manifest: () => manifest,
    });

    const { generateManifestCommand } = await import('./generate-manifest.js');
    await generateManifestCommand('analytics/api.ts', {
      output: 'analytics/hypequery-manifest.json',
    });

    expect(mockLoadApiModule).toHaveBeenCalledWith('analytics/api.ts');
    expect(mkdir).toHaveBeenCalledWith('analytics', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      'analytics/hypequery-manifest.json',
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  });

  it('fails clearly when no API module path is provided', async () => {
    const { generateManifestCommand } = await import('./generate-manifest.js');

    await expect(generateManifestCommand(undefined)).rejects.toThrow(
      /Missing API module path[\s\S]*generate:manifest analytics\/api\.ts/,
    );
  });

  it('fails clearly when the exported API has no manifest method', async () => {
    mockLoadApiModule.mockResolvedValue({
      handler: () => undefined,
    });

    const { generateManifestCommand } = await import('./generate-manifest.js');

    await expect(generateManifestCommand('analytics/api.ts')).rejects.toThrow(
      /must provide a manifest\(\) method/,
    );
  });
});
