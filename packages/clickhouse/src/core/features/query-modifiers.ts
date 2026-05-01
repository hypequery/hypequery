import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { OrderDirection, type SelectQueryNode } from '../../types/index.js';

export class QueryModifiersFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addGroupBy(columns: string | string[]): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const existingExpressions = new Set((query.groupBy || []).map(item => item.expression));
    const groupByItems = (Array.isArray(columns) ? columns.map(String) : [String(columns)])
      .filter(expression => {
        if (existingExpressions.has(expression)) return false;
        existingExpressions.add(expression);
        return true;
      })
      .map(expression => ({ kind: 'group-by-item' as const, expression }));
    return {
      ...query,
      groupBy: [...(query.groupBy || []), ...groupByItems]
    };
  }

  addLimit(count: number): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    return {
      ...query,
      limit: count
    };
  }

  addOffset(count: number): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    return {
      ...query,
      offset: count
    };
  }

  addOrderBy(column: string, direction: OrderDirection = 'ASC'): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    return {
      ...query,
      orderBy: [...(query.orderBy || []), { kind: 'order-by-item' as const, column, direction }]
    };
  }

  addHaving(condition: string, parameters?: any[]): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const having = [
      ...(query.having || []),
      {
        kind: 'having' as const,
        expression: condition,
        parameters: parameters?.map(value => ({ kind: 'value' as const, value })),
      }
    ];

    return {
      ...query,
      having
    };
  }

  setDistinct(): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    return {
      ...query,
      distinct: true
    };
  }
}
