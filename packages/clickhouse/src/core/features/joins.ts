import { QueryBuilder } from '../query-builder.js';
import { ColumnType, JoinType } from '../../types/index.js';

export class JoinFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

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