import { QueryBuilder } from '../query-builder';
import { ColumnType } from '../../types';
import { ClickHouseConnection } from '../connection';
import { substituteParameters } from '../utils';

export class ExecutorFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  toSQLWithParams(): { sql: string, parameters: any[] } {
    const sql = this.toSQLWithoutParameters();
    const config = this.builder.getConfig();
    const parameters = config.parameters || [];
    return { sql, parameters };
  }

  toSQL(): string {
    const { sql, parameters } = this.toSQLWithParams();
    return substituteParameters(sql, parameters);
  }

  async execute(): Promise<T[]> {
    const client = ClickHouseConnection.getClient();
    const { sql, parameters } = this.toSQLWithParams();
    const finalSQL = substituteParameters(sql, parameters);
    const result = await client.query({
      query: finalSQL,
      format: 'JSONEachRow'
    });

    return result.json<T[]>();
  }

  private toSQLWithoutParameters(): string {
    const config = this.builder.getConfig();
    const formatter = this.builder.getFormatter();
    const parts: string[] = [];

    if (config.ctes?.length) {
      parts.push(`WITH ${config.ctes.join(', ')}`);
    }

    parts.push(`SELECT ${formatter.formatSelect(config)}`);
    parts.push(`FROM ${this.builder.getTableName()}`);

    if (config.joins?.length) {
      parts.push(formatter.formatJoins(config));
    }

    if (config.where?.length) {
      parts.push(`WHERE ${formatter.formatWhere(config)}`);
    }

    if (config.groupBy?.length) {
      parts.push(`GROUP BY ${formatter.formatGroupBy(config)}`);
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
} 