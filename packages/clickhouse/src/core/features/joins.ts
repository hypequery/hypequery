import { QueryBuilder } from '../query-builder.js';
import { JoinType } from '../../types/index.js';
import { ColumnType } from '../../types/schema.js';

export class JoinFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T,
  VisibleTables extends keyof Schema = never
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT, VisibleTables>) { }

  addJoin<TableName extends keyof Schema>(
    type: JoinType,
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ) {
    const config = this.builder.getConfig();
    const newConfig = {
      ...config,
      joins: [
        ...(config.joins || []),
        { type, table: String(table), leftColumn: String(leftColumn), rightColumn, alias }
      ]
    };
    return newConfig;
  }
} 
