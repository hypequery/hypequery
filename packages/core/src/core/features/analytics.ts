import { QueryBuilder } from '../query-builder';
import { ColumnType, TableColumn } from '../../types';
import { ClickHouseSettings } from '@clickhouse/client-web';

export class AnalyticsFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  addCTE(alias: string, subquery: QueryBuilder<any, any> | string) {
    const config = this.builder.getConfig();
    const cte = typeof subquery === 'string' ? subquery : subquery.toSQL();
    return {
      ...config,
      ctes: [...(config.ctes || []), `${alias} AS (${cte})`]
    };
  }

  addTimeInterval(
    column: keyof T | TableColumn<Schema>,
    interval: string,
    method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear'
  ) {
    const config = this.builder.getConfig();
    const groupBy = config.groupBy || [];

    if (method === 'toStartOfInterval') {
      groupBy.push(`${method}(${String(column)}, INTERVAL ${interval})`);
    } else {
      groupBy.push(`${method}(${String(column)})`);
    }

    return {
      ...config,
      groupBy
    };
  }

  addSettings(opts: ClickHouseSettings) {
    const config = this.builder.getConfig();
    const settingsFragments = Object.entries(opts).map(([key, value]) => `${key}=${value}`);
    return {
      ...config,
      settings: settingsFragments.join(', ')
    };
  }
} 