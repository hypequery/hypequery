import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { OrderDirection } from '../../types/index.js';

export class QueryModifiersFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addGroupBy(columns: string | string[]) {
    const config = this.builder.getConfig();
    return {
      ...config,
      groupBy: (Array.isArray(columns) ? columns.map(String) : [String(columns)])
        .map(expression => ({ kind: 'group-by-item' as const, expression }))
    };
  }

  addLimit(count: number) {
    const config = this.builder.getConfig();
    return {
      ...config,
      limit: count
    };
  }

  addOffset(count: number) {
    const config = this.builder.getConfig();
    return {
      ...config,
      offset: count
    };
  }

  addOrderBy(column: string, direction: OrderDirection = 'ASC') {
    const config = this.builder.getConfig();
    return {
      ...config,
      orderBy: [...(config.orderBy || []), { kind: 'order-by-item' as const, column, direction }]
    };
  }

  addHaving(condition: string, parameters?: any[]) {
    const config = this.builder.getConfig();
    const having = [
      ...(config.having || []),
      {
        kind: 'having' as const,
        expression: condition,
        parameters: parameters?.map(value => ({ kind: 'value' as const, value })),
      }
    ];

    return {
      ...config,
      having
    };
  }

  setDistinct() {
    const config = this.builder.getConfig();
    return {
      ...config,
      distinct: true
    };
  }
}
