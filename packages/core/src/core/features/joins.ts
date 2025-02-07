import { QueryBuilder } from '../query-builder';
import { ColumnType, JoinType } from '../../types';

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
    return {
      ...config,
      joins: [
        ...(config.joins || []),
        { type, table: String(table), leftColumn: String(leftColumn), rightColumn, alias }
      ]
    };
  }
} 