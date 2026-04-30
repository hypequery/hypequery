import { ClickHouseSettings } from '@clickhouse/client-common';
import type { AnyBuilderState, BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type { SqlDialect } from '../dialects/sql-dialect.js';
import type { PredicateExpression } from '../utils/predicate-builder.js';
import { substituteParameters } from '../utils.js';
import type { SelectQueryNode } from '../../types/index.js';

export class AnalyticsFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addCTE(alias: string, subquery: QueryBuilder<any, AnyBuilderState> | string): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const cte = typeof subquery === 'string' ? subquery : subquery.toSQL();
    return {
      ...query,
      ctes: [...(query.ctes || []), { kind: 'cte' as const, expression: `${alias} AS (${cte})` }]
    };
  }

  addScalar(alias: string, expression: PredicateExpression): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const scalarExpression = substituteParameters(expression.sql, expression.parameters);
    return {
      ...query,
      ctes: [...(query.ctes || []), { kind: 'cte' as const, expression: `${scalarExpression} AS ${alias}` }]
    };
  }

  addTimeInterval(
    column: string,
    interval: string,
    method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear',
    dialect: SqlDialect,
  ): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const groupBy = [
      ...(query.groupBy || []),
      { kind: 'group-by-item' as const, expression: dialect.formatTimeInterval(column, interval, method) }
    ];

    return {
      ...query,
      groupBy
    };
  }

  addSettings(opts: ClickHouseSettings): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    return {
      ...query,
      settings: {
        ...(query.settings || {}),
        ...opts,
      }
    };
  }
}
