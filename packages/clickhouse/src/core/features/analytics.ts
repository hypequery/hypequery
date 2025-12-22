import { ClickHouseSettings } from '@clickhouse/client-common';
import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';

export class AnalyticsFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, keyof Schema, any, keyof Schema>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addCTE(alias: string, subquery: QueryBuilder<any, BuilderState<any, any, any, any>> | string) {
    const config = this.builder.getConfig();
    const cte = typeof subquery === 'string' ? subquery : subquery.toSQL();
    return {
      ...config,
      ctes: [...(config.ctes || []), `${alias} AS (${cte})`]
    };
  }

  addTimeInterval(
    column: string,
    interval: string,
    method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear'
  ) {
    const config = this.builder.getConfig();
    const groupBy = config.groupBy || [];

    if (method === 'toStartOfInterval') {
      groupBy.push(`${method}(${column}, INTERVAL ${interval})`);
    } else {
      groupBy.push(`${method}(${column})`);
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
