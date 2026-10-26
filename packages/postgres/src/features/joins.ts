import type { ConditionNode, JoinNode, PostgresSelectNode } from '../types.js';
import { updateSelectNode } from '../query-node.js';
import { isPostgresFilterOperator } from './filtering.js';

/** A join condition as the datasets planner passes it. */
export interface JoinConditionInput {
  column: string;
  operator: string;
  value: unknown;
}

export type JoinKeyPairs = readonly [readonly [string, string], ...(readonly [string, string])[]];

/** LEFT joins, including the single-match join relationship traversal relies on. */
export class JoinFeature {
  constructor(private readonly node: () => PostgresSelectNode) {}

  leftJoin(
    table: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
    on?: JoinConditionInput | JoinConditionInput[],
  ): PostgresSelectNode {
    return this.append('left', table, [[leftColumn, rightColumn]], alias, on);
  }

  leftAnyJoin(
    table: string,
    leftOrKeys: string | JoinKeyPairs,
    rightOrAlias?: string,
    aliasOrOn?: string | JoinConditionInput | JoinConditionInput[],
    on?: JoinConditionInput | JoinConditionInput[],
  ): PostgresSelectNode {
    if (typeof leftOrKeys === 'string') {
      if (rightOrAlias === undefined) throw new Error('leftAnyJoin needs a right column.');
      if (aliasOrOn !== undefined && typeof aliasOrOn !== 'string') {
        throw new Error('leftAnyJoin takes an alias before its join conditions.');
      }
      return this.append('left-single-match', table, [[leftOrKeys, rightOrAlias]], aliasOrOn, on);
    }
    if (aliasOrOn !== undefined && typeof aliasOrOn === 'string') {
      throw new Error('leftAnyJoin with key pairs takes its alias before its join conditions.');
    }
    return this.append('left-single-match', table, leftOrKeys, rightOrAlias, aliasOrOn);
  }

  private append(
    strategy: JoinNode['strategy'],
    source: string,
    keys: readonly (readonly [string, string])[],
    alias: string | undefined,
    on: JoinConditionInput | JoinConditionInput[] | undefined,
  ): PostgresSelectNode {
    if (keys.length === 0) throw new Error('A join needs at least one key pair.');
    const node = this.node();
    const join: JoinNode = {
      kind: 'join',
      strategy,
      source,
      ...(alias === undefined ? {} : { alias }),
      keys: keys.map(([left, right]) => [left, right] as const),
      conditions: toConditions(on),
    };
    return updateSelectNode(node, { joins: [...node.joins, join] });
  }
}

function toConditions(on: JoinConditionInput | JoinConditionInput[] | undefined): ConditionNode[] {
  if (on === undefined) return [];
  return (Array.isArray(on) ? on : [on]).map(({ column, operator, value }) => {
    if (!isPostgresFilterOperator(operator)) throw new Error(`Unsupported join condition operator: ${operator}`);
    return { kind: 'condition', column, operator, value };
  });
}
