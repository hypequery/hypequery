import { QueryBuilder } from '../query-builder.js';
import { ColumnType } from '../../types/index.js';

export class AggregationFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  private createAggregation<Column extends keyof OriginalT, Alias extends string>(
    column: Column,
    fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    alias: Alias
  ) {
    const aggregationSQL = `${fn}(${String(column)}) AS ${alias}`;
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

  sum<Column extends keyof OriginalT, Alias extends string = `${Column & string}_sum`>(
    column: Column,
    alias?: Alias
  ) {
    return this.createAggregation(
      column,
      'SUM',
      alias || `${String(column)}_sum`
    );
  }

  count<Column extends keyof OriginalT, Alias extends string = `${Column & string}_count`>(
    column: Column,
    alias?: Alias
  ) {
    return this.createAggregation(
      column,
      'COUNT',
      alias || `${String(column)}_count`
    );
  }

  avg<Column extends keyof OriginalT, Alias extends string = `${Column & string}_avg`>(
    column: Column,
    alias?: Alias
  ) {
    return this.createAggregation(
      column,
      'AVG',
      alias || `${String(column)}_avg`
    );
  }

  min<Column extends keyof OriginalT, Alias extends string = `${Column & string}_min`>(
    column: Column,
    alias?: Alias
  ) {
    return this.createAggregation(
      column,
      'MIN',
      alias || `${String(column)}_min`
    );
  }

  max<Column extends keyof OriginalT, Alias extends string = `${Column & string}_max`>(
    column: Column,
    alias?: Alias
  ) {
    return this.createAggregation(
      column,
      'MAX',
      alias || `${String(column)}_max`
    );
  }
} 