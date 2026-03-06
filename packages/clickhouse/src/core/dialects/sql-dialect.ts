import type { QueryConfig } from '../../types/index.js';

export interface CompileQueryContext {
  tableName: string;
}

export interface SqlDialect {
  readonly name: string;
  compileQuery(config: QueryConfig<any, any>, context: CompileQueryContext): string;
  formatTimeInterval(
    column: string,
    interval: string,
    method: string,
  ): string;
  formatSettings(settings: Record<string, unknown>): string;
}
