import type { DatabaseType } from '../utils/detect-database.js';
import type { ClickHouseGeneratorOptions } from './clickhouse.js';
import type { ChdbGeneratorOptions } from './chdb.js';

export type TypeGeneratorOptions = ClickHouseGeneratorOptions & ChdbGeneratorOptions;

type GeneratorFn = (options: TypeGeneratorOptions) => Promise<void>;

// Loaded on demand. Both generators pull in `@hypequery/clickhouse/cli`, and importing
// that eagerly puts it on the module graph of every command — a resolution failure there
// took down even `hypequery --help`. Deferring it keeps the blast radius on the commands
// that actually generate types.
const generators: Partial<Record<DatabaseType, GeneratorFn>> = {
  clickhouse: async (options) => {
    const { generateClickHouseTypes } = await import('./clickhouse.js');
    await generateClickHouseTypes(options);
  },
  chdb: async (options) => {
    const { generateChdbTypes } = await import('./chdb.js');
    await generateChdbTypes(options);
  },
};

export function getTypeGenerator(dbType: DatabaseType): GeneratorFn {
  const generator = generators[dbType];

  if (!generator) {
    throw new Error(
      dbType === 'unknown'
        ? 'Unable to detect database type. Re-run `hypequery generate --database <type>` or pass `--database` explicitly.'
        : `Type generation for ${dbType} is not supported yet.`
    );
  }

  return generator;
}
