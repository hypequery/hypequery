import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { TelemetryInvocation } from '../utils/telemetry/invocation.js';
import { CommandLifecycle } from '../utils/telemetry/lifecycle.js';
import { withCommandTelemetry } from '../utils/telemetry/command-context.js';
import { CommandExit } from '../utils/command-exit.js';
import { common } from '../../type-tests/fixtures.js';
import { validateTelemetryEvent } from '../utils/telemetry/validation.js';

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

  it('records bucketed manifest/registry sizes and custom-output use without endpoint content', async () => {
    const record = vi.fn();
    const spy = vi.spyOn(TelemetryInvocation, 'create').mockResolvedValue({ common, record, flush: vi.fn() } as unknown as TelemetryInvocation);
    try {
      const lifecycle = new CommandLifecycle(['generate:manifest']);
      await lifecycle.begin('generate:manifest');
      mockLoadApiModule.mockResolvedValue({ queries: { PRIVATE_QUERY: {} }, manifest: () => ({ PRIVATE_ROUTE: { path: 'PRIVATE_PATH' }, PRIVATE_OTHER_ROUTE: {} }) });
      const { generateManifestCommand } = await import('./generate-manifest.js');
      await withCommandTelemetry(lifecycle, () => generateManifestCommand('PRIVATE_API', { output: 'PRIVATE_OUTPUT' }));
      await lifecycle.finish(new CommandExit(0, 'success'));
      const event = record.mock.calls[0][0];
      expect(event.properties).toMatchObject({ custom_output: true, query_count_bucket: '1', endpoint_count_bucket: '2-5' });
      expect(validateTelemetryEvent(event)).toBe(true);
      expect(JSON.stringify(event)).not.toContain('PRIVATE');
    } finally { spy.mockRestore(); }
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
