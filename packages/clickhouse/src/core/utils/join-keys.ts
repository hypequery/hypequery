import type { JoinConditionInput, JoinKeyNode } from '../../types/index.js';

/** Normalize both public signatures without retaining caller-owned key arrays. */
export function normalizeJoinArguments(
  leftColumnOrKeys: unknown,
  rightColumnOrAlias: unknown,
  aliasOrOn: unknown,
  on?: JoinConditionInput | JoinConditionInput[],
): {
  firstKey: JoinKeyNode;
  additionalKeys?: JoinKeyNode[];
  alias?: string;
  on?: JoinConditionInput | JoinConditionInput[];
} {
  if (!Array.isArray(leftColumnOrKeys)) {
    return {
      firstKey: { leftColumn: String(leftColumnOrKeys), rightColumn: String(rightColumnOrAlias) },
      alias: aliasOrOn as string | undefined,
      on,
    };
  }
  if (!leftColumnOrKeys.length) {
    throw new Error('A join requires at least one column pair');
  }
  const keys = Array.from(leftColumnOrKeys, pair => {
    if (
      !Array.isArray(pair) || pair.length !== 2
      || typeof pair[0] !== 'string' || !pair[0].length
      || typeof pair[1] !== 'string' || !pair[1].length
    ) {
      throw new Error('Each join key must be a pair of non-empty column names');
    }
    return { leftColumn: pair[0] as string, rightColumn: pair[1] as string };
  });
  return {
    firstKey: keys[0],
    additionalKeys: keys.slice(1),
    alias: rightColumnOrAlias as string | undefined,
    on: aliasOrOn as JoinConditionInput | JoinConditionInput[] | undefined,
  };
}

/** Right inputs use table qualifiers even when the joined table has an alias. */
export function aliasJoinKey(key: JoinKeyNode, table: string, alias?: string): JoinKeyNode {
  const prefix = `${table}.`;
  return {
    ...key,
    rightColumn: alias && key.rightColumn.startsWith(prefix)
      ? `${alias}.${key.rightColumn.slice(prefix.length)}`
      : key.rightColumn,
  };
}
