import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

type LoadModule = typeof import('./load-api.js')['loadModule'];

vi.mock('./load-api.js', () => ({
  loadModule: vi.fn(),
}));

describe('load-hypequery-config', () => {
  let loadModule: ReturnType<typeof vi.mocked<LoadModule>>;

  beforeEach(async () => {
    vi.resetModules();
    ({ loadModule } = await import('./load-api.js'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads and resolves defaults from a config module', async () => {
    loadModule.mockResolvedValue({
      default: {
        dialect: 'clickhouse',
        schema: './src/schema.ts',
        dbCredentials: {
          host: 'localhost',
          username: 'default',
          database: 'analytics',
        },
      },
    });

    const { loadHypequeryConfig } = await import('./load-hypequery-config.js');
    const config = await loadHypequeryConfig();

    expect(loadModule).toHaveBeenCalledWith('hypequery.config.ts');
    expect(config.migrations).toEqual({
      out: './migrations',
      table: '_hypequery_migrations',
      prefix: 'timestamp',
    });
  });

  it('throws for invalid config exports', async () => {
    loadModule.mockResolvedValue({
      default: {
        dialect: 'clickhouse',
      },
    });

    const { loadHypequeryConfig } = await import('./load-hypequery-config.js');

    await expect(loadHypequeryConfig('custom.config.ts')).rejects.toThrow(
      /Invalid hypequery config: custom\.config\.ts[\s\S]*schema/,
    );
  });
});
