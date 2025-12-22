import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { OrderDirection } from '../../types/index.js';

export class QueryModifiersFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, keyof Schema, any, keyof Schema>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addGroupBy(columns: string | string[]) {
    const config = this.builder.getConfig();
    return {
      ...config,
      groupBy: Array.isArray(columns) ? columns.map(String) : [String(columns)]
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
      orderBy: [...(config.orderBy || []), { column, direction }]
    };
  }

  addHaving(condition: string, parameters?: any[]) {
    const config = this.builder.getConfig();
    const having = [...(config.having || []), condition];
    const newParams = parameters ? [...(config.parameters || []), ...parameters] : config.parameters;

    return {
      ...config,
      having,
      parameters: newParams
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
