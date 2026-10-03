import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import {
  JoinType,
  type JoinConditionInput,
  type JoinKeyNode,
  type SelectQueryNode,
} from '../../types/index.js';

import { buildOnExpression } from '../utils/join-conditions.js';
import { aliasJoinKey } from '../utils/join-keys.js';

export class JoinFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  /**
   * Join targets are plain identifiers here: the caller has already checked the
   * table against the schema, or the CTEs declared on the query.
   */
  addJoin(
    type: JoinType,
    table: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
    leftSource?: string,
    on?: JoinConditionInput | JoinConditionInput[],
    additionalKeys?: JoinKeyNode[],
  ): SelectQueryNode<State['output'], Schema> {
    const query = this.builder.getQueryNode();
    const firstKey = aliasJoinKey({ leftColumn: String(leftColumn), rightColumn }, table, alias);
    const newConfig = {
      ...query,
      joins: [
        ...(query.joins || []),
        {
          kind: 'join' as const,
          type,
          table: String(table),
          leftColumn: firstKey.leftColumn,
          leftSource,
          rightColumn: firstKey.rightColumn,
          ...(additionalKeys?.length ? { additionalKeys: additionalKeys.map(key => aliasJoinKey(key, table, alias)) } : {}),
          alias,
          on: on ? buildOnExpression(on) : undefined,
        }
      ]
    };
    return newConfig;
  }
}
