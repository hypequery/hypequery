import { ClickHouseSettings } from '@clickhouse/client-common';
import type { AnyBuilderState, BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type { SqlDialect } from '../dialects/sql-dialect.js';
import type { PredicateExpression } from '../utils/predicate-builder.js';
import { substituteParameters } from '../utils.js';
import { renderCteBody } from '../utils/cte-fragments.js';
import { terminateTrailingLineComment } from '../utils/sql-parens.js';
import { bindNamedParameters } from '../utils/named-parameters.js';
import type { RawCteBody, SelectQueryNode } from '../../types/index.js';

/** Every form a CTE body can take. */
export type CteBody = QueryBuilder<any, AnyBuilderState> | string | RawCteBody;

/** A CTE body compiled to a bindable fragment plus its already-rendered form. */
interface CompiledCteBody {
  body: string;
  parameters: unknown[];
  rendered: string;
}

export class AnalyticsFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addCTE(
    alias: string,
    subquery: CteBody,
    options: { recursive?: boolean } = {},
  ): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const { body, parameters, rendered } = this.compileCteBody(subquery);

    return {
      ...query,
      // RECURSIVE belongs to the WITH clause, so one recursive entry marks the
      // whole list and a later plain entry never clears it.
      recursiveCtes: options.recursive ? true : query.recursiveCtes,
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

  /**
   * A builder subquery is compiled with its placeholders intact so its values
   * stay bound, and a raw body's `{name:Type}` placeholders are rewritten to the
   * same positional markers. `rendered` keeps the inlined form the node has
   * always carried, using the path `toSQL()` takes.
   */
  private compileCteBody(subquery: CteBody): CompiledCteBody {
    if (typeof subquery === 'string') {
      const body = terminateTrailingLineComment(subquery);
      return { body, parameters: [], rendered: body };
    }

    if (subquery instanceof QueryBuilder) {
      const compiled = subquery.toSQLWithParams();
      return {
        body: compiled.sql,
        parameters: compiled.parameters,
        rendered: renderCteBody(compiled.sql, compiled.parameters, this.builder.getAdapter()),
      };
    }

    const bound = bindNamedParameters(subquery.sql.trim(), subquery.parameters, 'CTE body');
    const body = terminateTrailingLineComment(bound.sql);
    return {
      body,
      parameters: bound.parameters,
      // With nothing bound there is nothing to substitute, and a stray `?` in
      // the body would be mistaken for a placeholder.
      rendered: bound.parameters.length
        ? renderCteBody(body, bound.parameters, this.builder.getAdapter())
        : body,
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
