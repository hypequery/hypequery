import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { JoinType } from '../../types/index.js';

export class JoinFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addJoin<TableName extends keyof Schema>(
    type: JoinType,
    table: TableName,
    leftColumn: string,
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
