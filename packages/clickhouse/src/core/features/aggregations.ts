import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type { SelectQueryNode, SelectionNode } from '../../types/index.js';

export class AggregationFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  private static readonly TRAILING_ALIAS_PATTERN = /\s+AS\s+[A-Za-z_][A-Za-z0-9_]*$/i;
  private static readonly LEADING_AGGREGATE_CALL_PATTERN = /^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;

  constructor(private builder: QueryBuilder<Schema, State>) { }

  private stripTrailingAlias(selection: string) {
    return selection.replace(AggregationFeature.TRAILING_ALIAS_PATTERN, '').trim();
  }

  private isAggregateSelection(selection: string) {
    const expressionWithoutAlias = this.stripTrailingAlias(selection);
    return AggregationFeature.LEADING_AGGREGATE_CALL_PATTERN.test(expressionWithoutAlias);
  }

  private createAggregateSelection(selection: string): SelectionNode {
    return {
      kind: 'selection',
      selection,
      isAggregate: true,
    };
  }

  private shouldInferGroupByFromSelection(item: SelectionNode) {
    if (item.selection === '*') {
      return false;
    }

    if (item.isAggregate === true) {
      return false;
    }

    return !this.isAggregateSelection(item.selection);
  }

  private inferGroupBySelections(select: SelectionNode[]) {
    return select
      .filter(item => this.shouldInferGroupByFromSelection(item))
      .map(item => item.selection)
      .map(selection => {
        const aliasMatch = selection.match(/\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
        return {
          kind: 'group-by-item' as const,
          expression: aliasMatch ? aliasMatch[1] : selection,
        };
      });
  }

  private createAggregation(
    column: string,
    fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    alias: string
  ): SelectQueryNode<State['output'], Schema> {
    const aggregationSQL = `${fn}(${column}) AS ${alias}`;
    const query = this.builder.getQueryNode();

    if (query.select) {
      return {
        ...query,
        select: [...query.select, this.createAggregateSelection(aggregationSQL)],
        groupBy: query.groupBy || this.inferGroupBySelections(query.select)
      };
    }

    return {
      ...query,
      select: [this.createAggregateSelection(aggregationSQL)]
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

  countDistinct(column: string, alias: string) {
    const aggregationSQL = `COUNT(DISTINCT ${column}) AS ${alias}`;
    const query = this.builder.getQueryNode();

    if (query.select) {
      return {
        ...query,
        select: [...query.select, this.createAggregateSelection(aggregationSQL)],
        groupBy: query.groupBy || this.inferGroupBySelections(query.select),
      };
    }

    return {
      ...query,
      select: [this.createAggregateSelection(aggregationSQL)],
    };
  }
}
