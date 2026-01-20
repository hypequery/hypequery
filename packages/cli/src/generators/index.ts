import type { DatabaseType } from '../utils/detect-database.js';
import { generateClickHouseTypes, type ClickHouseGeneratorOptions } from './clickhouse.js';

export type TypeGeneratorOptions = ClickHouseGeneratorOptions;

type GeneratorFn = (options: TypeGeneratorOptions) => Promise<void>;

const generators: Partial<Record<DatabaseType, GeneratorFn>> = {
  clickhouse: generateClickHouseTypes,
};

export function getTypeGenerator(dbType: DatabaseType): GeneratorFn {
  const generator = generators[dbType];

  if (!generator) {
    throw new Error(
      dbType === 'unknown'
        ? 'Unable to detect database type. Re-run `hypequery init --database <type>` or pass `--database` explicitly.'
        : `Type generation for ${dbType} is not supported yet.`
    );
  }

  return generator;
}
