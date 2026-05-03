import type { CompiledQuery, SelectQueryNode } from '../../types/index.js';
import { SQLFormatter } from '../formatters/sql-formatter.js';
import type { CompileQueryContext, SqlDialect } from './sql-dialect.js';

export class ClickHouseDialect implements SqlDialect {
  readonly name = 'clickhouse';
  private formatter = new SQLFormatter();

  compileQuery(query: SelectQueryNode<any, any>, context: CompileQueryContext): CompiledQuery {
    const parts: string[] = [];
    const parameters: unknown[] = [];

    if (query.ctes?.length) {
      parts.push(`WITH ${this.formatter.formatCtes(query)}`);
    }

    parts.push(`SELECT ${this.formatter.formatSelect(query)}`);
    parts.push(`FROM ${this.formatter.formatFrom(query.from ?? { kind: 'table', name: context.tableName })}`);

    if (query.arrayJoins?.length) {
      parts.push(this.formatter.formatArrayJoins(query));
    }

    if (query.joins?.length) {
      parts.push(this.formatter.formatJoins(query));
    }

    if (query.prewhere) {
      const compiled = this.formatter.compileExpr(query.prewhere);
      parts.push(`PREWHERE ${compiled.query}`);
      parameters.push(...compiled.parameters);
    }

    if (query.where) {
      const compiled = this.formatter.compileExpr(query.where);
      parts.push(`WHERE ${compiled.query}`);
      parameters.push(...compiled.parameters);
    }

    if (query.groupBy?.length) {
      const groupByClause = `GROUP BY ${this.formatter.formatGroupBy(query)}`;
      parts.push(query.withTotals ? `${groupByClause} WITH TOTALS` : groupByClause);
    }

    if (query.having?.length) {
      const compiled = this.formatter.compileHaving(query);
      parts.push(`HAVING ${compiled.query}`);
      parameters.push(...compiled.parameters);
    }

    if (query.orderBy?.length) {
      parts.push(`ORDER BY ${this.formatter.formatOrderBy(query)}`);
    }

    if (query.limitBy) {
      parts.push(`LIMIT ${this.formatter.formatLimitBy(query)}`);
    }

    if (query.limit) {
      const offsetClause = query.offset ? `OFFSET ${query.offset}` : '';
      parts.push(`LIMIT ${query.limit} ${offsetClause}`);
    }

    return {
      query: parts.join(' ').trim(),
      parameters,
    };
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
