import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import type {
  JoinType,
  JoinConditionInput,
  JoinKeyNode,
  SelectQueryNode,
} from '../../types/index.js';
import { buildOnExpression } from '../utils/join-conditions.js';
import { aliasJoinKey } from '../utils/join-keys.js';

interface JoinOptions {
  alias?: string;
  leftSource?: string;
  on?: JoinConditionInput | JoinConditionInput[];
  additionalKeys?: JoinKeyNode[];
}

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
    options?: JoinOptions,
  ): SelectQueryNode<State['output'], Schema>;
  /** @deprecated Pass join options as an object. */
  addJoin(
    type: JoinType,
    table: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
    leftSource?: string,
    on?: JoinConditionInput | JoinConditionInput[],
    additionalKeys?: JoinKeyNode[],
  ): SelectQueryNode<State['output'], Schema>;
  addJoin(
    type: JoinType,
    table: string,
    leftColumn: string,
    rightColumn: string,
    aliasOrOptions?: string | JoinOptions,
    legacyLeftSource?: string,
    legacyOn?: JoinConditionInput | JoinConditionInput[],
    legacyAdditionalKeys?: JoinKeyNode[],
  ): SelectQueryNode<State['output'], Schema> {
    const { alias, leftSource, on, additionalKeys } = typeof aliasOrOptions === 'object'
      ? aliasOrOptions
      : { alias: aliasOrOptions, leftSource: legacyLeftSource, on: legacyOn, additionalKeys: legacyAdditionalKeys };
    const query = this.builder.getQueryNode();
    const firstKey = aliasJoinKey({ leftColumn, rightColumn }, table, alias);
    const newConfig = {
      ...query,
      joins: [
        ...(query.joins || []),
        {
          kind: 'join' as const,
          type,
          table,
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
