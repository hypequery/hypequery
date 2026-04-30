import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type { SelectQueryNode } from '../../types/index.js';

export class AggregationFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  private createAggregation(
    column: string,
    fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    alias: string
  ): SelectQueryNode<State['output'], Schema> {
    const aggregationSQL = `${fn}(${column}) AS ${alias}`;
    const query = this.builder.getQueryNode();

    if (query.select) {
      const selections = query.select.map(item => item.selection);
      return {
        ...query,
        select: [...query.select, { kind: 'selection' as const, selection: aggregationSQL }],
        groupBy: selections
          .filter(col => !col.includes(' AS '))
          .map(expression => ({ kind: 'group-by-item' as const, expression }))
      };
    }

    return {
      ...query,
      select: [{ kind: 'selection' as const, selection: aggregationSQL }]
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
