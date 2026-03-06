import type { QueryConfig } from '../../types/index.js';
import { SQLFormatter } from '../formatters/sql-formatter.js';
import type { CompileQueryContext, SqlDialect } from './sql-dialect.js';

export class ClickHouseDialect implements SqlDialect {
  readonly name = 'clickhouse';
  private formatter = new SQLFormatter();

  compileQuery(config: QueryConfig<any, any>, context: CompileQueryContext): string {
    const parts: string[] = [];

    if (config.ctes?.length) {
      parts.push(`WITH ${config.ctes.join(', ')}`);
    }

    parts.push(`SELECT ${this.formatter.formatSelect(config)}`);
    parts.push(`FROM ${context.tableName}`);

    if (config.joins?.length) {
      parts.push(this.formatter.formatJoins(config));
    }

    if (config.where?.length) {
      parts.push(`WHERE ${this.formatter.formatWhere(config)}`);
    }

    if (config.groupBy?.length) {
      parts.push(`GROUP BY ${this.formatter.formatGroupBy(config)}`);
    }

    if (config.having?.length) {
      parts.push(`HAVING ${config.having.join(' AND ')}`);
    }

    if (config.orderBy?.length) {
      const orderBy = config.orderBy
        .map(({ column, direction }) => `${String(column)} ${direction}`.trim())
        .join(', ');
      parts.push(`ORDER BY ${orderBy}`);
    }

    if (config.limit) {
      const offsetClause = config.offset ? `OFFSET ${config.offset}` : '';
      parts.push(`LIMIT ${config.limit} ${offsetClause}`);
    }

    return parts.join(' ').trim();
  }

  formatTimeInterval(column: string, interval: string, method: string): string {
    if (method === 'toStartOfInterval') {
      return `${method}(${column}, INTERVAL ${interval})`;
    }

    return `${method}(${column})`;
  }

  formatSettings(settings: Record<string, unknown>): string {
    return Object.entries(settings)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
  }
}
