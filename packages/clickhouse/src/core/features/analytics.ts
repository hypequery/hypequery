import { ClickHouseSettings } from '@clickhouse/client-common';
import type { AnyBuilderState, BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type { SqlDialect } from '../dialects/sql-dialect.js';
import type { PredicateExpression } from '../utils/predicate-builder.js';
import { substituteParameters } from '../utils.js';
import type { QueryConfig } from '../../types/index.js';

export class AnalyticsFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addCTE(alias: string, subquery: QueryBuilder<any, AnyBuilderState> | string): QueryConfig<State['output'], Schema> {
    const config = this.builder.getConfig();
    const cte = typeof subquery === 'string' ? subquery : subquery.toSQL();
    return {
      ...config,
      ctes: [...(config.ctes || []), { kind: 'cte' as const, expression: `${alias} AS (${cte})` }]
    };
  }

  addScalar(alias: string, expression: PredicateExpression): QueryConfig<State['output'], Schema> {
    const config = this.builder.getConfig();
    const scalarExpression = substituteParameters(expression.sql, expression.parameters);
    return {
      ...config,
      ctes: [...(config.ctes || []), { kind: 'cte' as const, expression: `${scalarExpression} AS ${alias}` }]
    };
  }

  addTimeInterval(
    column: string,
    interval: string,
    method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear',
    dialect: SqlDialect,
  ): QueryConfig<State['output'], Schema> {
    const config = this.builder.getConfig();
    const groupBy = [
      ...(config.groupBy || []),
      { kind: 'group-by-item' as const, expression: dialect.formatTimeInterval(column, interval, method) }
    ];

    return {
      ...config,
      groupBy
    };
  }

  addSettings(opts: ClickHouseSettings): QueryConfig<State['output'], Schema> {
    const config = this.builder.getConfig();
    return {
      ...config,
      settings: {
        ...(config.settings || {}),
        ...opts,
      }
    };
  }
}
