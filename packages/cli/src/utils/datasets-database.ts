import { detectDatabase } from './detect-database.js';

/** The engines dataset commands work against. */
export type DatasetsDatabase = 'clickhouse' | 'postgres';

/** The `--database` flag, else the engine the project's environment points at (ClickHouse by default). */
export async function resolveDatasetsDatabase(flag: string | undefined, command: string): Promise<DatasetsDatabase> {
  if (flag === 'clickhouse' || flag === 'postgres') return flag;
  if (flag !== undefined) {
    throw new Error(`Unsupported database "${flag}" for ${command}. Use "clickhouse" or "postgres".`);
  }
  return (await detectDatabase()) === 'postgres' ? 'postgres' : 'clickhouse';
}
