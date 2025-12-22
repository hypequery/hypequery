import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';

export class AggregationFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, keyof Schema, any, keyof Schema>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  private createAggregation(
    column: string,
    fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    alias: string
  ) {
    const aggregationSQL = `${fn}(${column}) AS ${alias}`;
    const config = this.builder.getConfig();

    if (config.select) {
      return {
        ...config,
        select: [...(config.select || []).map(String), aggregationSQL],
        groupBy: (config.select || []).map(String).filter(col => !col.includes(' AS '))
      };
    }

    return {
      ...config,
      select: [aggregationSQL]
    };
  }

  sum(column: string, alias: string) {
    return this.createAggregation(column, 'SUM', alias);
  }

  count(column: string, alias: string) {
    return this.createAggregation(column, 'COUNT', alias);
  }

  avg(column: string, alias: string) {
    return this.createAggregation(column, 'AVG', alias);
  }

  min(column: string, alias: string) {
    return this.createAggregation(column, 'MIN', alias);
  }

  max(column: string, alias: string) {
    return this.createAggregation(column, 'MAX', alias);
  }
}
