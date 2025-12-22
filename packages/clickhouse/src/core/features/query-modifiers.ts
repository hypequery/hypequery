import { QueryBuilder } from '../query-builder.js';
import { OrderDirection } from '../../types/index.js';
import { ColumnType, TableColumn } from '../../types/schema.js';

export class QueryModifiersFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T,
  VisibleTables extends keyof Schema = never
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT, VisibleTables>) { }

  addGroupBy(columns: (keyof T | TableColumn<Schema>) | Array<keyof T | TableColumn<Schema>>) {
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

  addOrderBy<K extends keyof T | TableColumn<Schema>>(column: K, direction: OrderDirection = 'ASC') {
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
