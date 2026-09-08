import { ClickHouseSettings } from '@clickhouse/client-common';
import type { AnyBuilderState, BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type { SqlDialect } from '../dialects/sql-dialect.js';
import type { PredicateExpression } from '../utils/predicate-builder.js';
import { substituteParameters } from '../utils.js';
import { renderCteBody } from '../utils/cte-fragments.js';
import { terminateTrailingLineComment } from '../utils/sql-parens.js';
import type { SelectQueryNode } from '../../types/index.js';

export class AnalyticsFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addCTE(alias: string, subquery: QueryBuilder<any, AnyBuilderState> | string): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    // A builder subquery is compiled with its placeholders intact so its values
    // stay bound. `expression` keeps the rendered form the node carried before,
    // using the same rendering path `toSQL()` takes.
    const compiled = typeof subquery === 'string' ? undefined : subquery.toSQLWithParams();
    const body = compiled ? compiled.sql : subquery as string;
    const parameters = compiled ? compiled.parameters : [];
    const rendered = compiled ? renderCteBody(body, parameters, this.builder.getAdapter()) : body;

    return {
      ...query,
      ctes: [
        ...(query.ctes || []),
        {
          kind: 'cte' as const,
          name: alias,
          body,
          parameters,
          expression: `${alias} AS (${rendered})`,
        }
      ]
    };
  }

  addScalar(alias: string, expression: PredicateExpression): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const scalarExpression = substituteParameters(
      terminateTrailingLineComment(expression.sql),
      expression.parameters
    );
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
