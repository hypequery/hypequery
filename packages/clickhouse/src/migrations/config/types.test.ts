import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_OUT_DIR,
  DEFAULT_MIGRATIONS_PREFIX,
  DEFAULT_MIGRATIONS_TABLE,
  defineConfig,
  resolveClickHouseConfig,
} from './types.js';

describe('clickhouse migration config', () => {
  it('preserves the config shape through defineConfig', () => {
    const config = defineConfig({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      dbCredentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
    });

    expect(config.schema).toBe('./src/schema.ts');
    expect(config.dialect).toBe('clickhouse');
  });

  it('applies deterministic migration defaults', () => {
    const resolved = resolveClickHouseConfig({
      dialect: 'clickhouse',
      schema: './src/schema.ts',
      dbCredentials: {
        host: 'localhost',
        username: 'default',
        database: 'analytics',
      },
    });

    expect(resolved.migrations).toEqual({
      out: DEFAULT_MIGRATIONS_OUT_DIR,
      table: DEFAULT_MIGRATIONS_TABLE,
      prefix: DEFAULT_MIGRATIONS_PREFIX,
    });
  });
});
