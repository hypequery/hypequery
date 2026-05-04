import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { JoinType, type SelectQueryNode } from '../../types/index.js';

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
    alias?: string,
    leftSource?: string
  ): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const renderedRightColumn = alias
      ? rightColumn.replace(`${String(table)}.`, `${alias}.`) as typeof rightColumn
      : rightColumn;
    const newConfig = {
      ...query,
      joins: [
        ...(query.joins || []),
        {
          kind: 'join' as const,
          type,
          table: String(table),
          leftColumn: String(leftColumn),
          leftSource,
          rightColumn: renderedRightColumn,
          alias,
        }
      ]
    };
    return newConfig;
  }
}
