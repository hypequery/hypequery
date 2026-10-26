import type { PostgresDriver, PostgresQueryOptions } from '../driver/driver.js';
import type { PostgresSelectNode } from '../types.js';
import { compileSelect } from '../compiler/compile-select.js';

export interface CompiledPostgresStatement {
  sql: string;
  parameters: unknown[];
}

/** Compile with `$n` placeholders numbered in text order. */
export function compileWithNumberedPlaceholders(node: PostgresSelectNode): CompiledPostgresStatement {
  const parameters: unknown[] = [];
  const sql = compileSelect(node, value => {
    parameters.push(value);
    return `$${parameters.length}`;
  });
  return { sql, parameters };
}

export class ExecutorFeature {
  constructor(
    private readonly node: () => PostgresSelectNode,
    private readonly driver: PostgresDriver | undefined,
  ) {}

  execute<T>(options?: PostgresQueryOptions): Promise<T[]> {
    const { sql, parameters } = compileWithNumberedPlaceholders(this.node());
    return requireDriver(this.driver).query<T>(sql, parameters, options);
  }
}

export function requireDriver(driver: PostgresDriver | undefined): PostgresDriver {
  if (!driver) {
    throw new Error('This Postgres query builder has no driver; pass `driver` or `pool` to createPostgresQueryBuilder to execute queries.');
  }
  return driver;
}
