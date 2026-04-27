import type { CompiledQuery, SelectQueryNode } from '../../types/index.js';

export interface CompileQueryContext {
  tableName: string;
}

export interface SqlDialect {
  readonly name: string;
  compileQuery(query: SelectQueryNode<any, any>, context: CompileQueryContext): CompiledQuery;
  formatTimeInterval(
    column: string,
    interval: string,
    method: string,
  ): string;
  formatSettings(settings: Record<string, unknown>): string;
}
