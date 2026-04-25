import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { JoinType, type QueryConfig } from '../../types/index.js';

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
  ): QueryConfig<State['output'], Schema> {
    const config = this.builder.getConfig();
    const renderedRightColumn = alias
      ? rightColumn.replace(`${String(table)}.`, `${alias}.`) as typeof rightColumn
      : rightColumn;
    const newConfig = {
      ...config,
      joins: [
        ...(config.joins || []),
        {
          kind: 'join' as const,
          type,
          table: String(table),
          leftColumn: String(leftColumn),
          rightColumn: renderedRightColumn,
          alias,
        }
      ]
    };
    return newConfig;
  }
}
