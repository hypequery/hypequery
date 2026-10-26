const QUOTED_ALIAS = /^([\s\S]+?)\s+AS\s+("(?:[^"]|"")+")$/i;

/**
 * Split `expr AS "alias"` into its expression and quoted alias. Only quoted
 * aliases are recognised: the datasets planner quotes every alias it
 * generates, and an unquoted trailing word cannot be told apart from SQL.
 */
export function splitQuotedAlias(selection: string): { expression: string; alias: string } | undefined {
  const match = QUOTED_ALIAS.exec(selection.trim());
  return match ? { expression: match[1]!, alias: match[2]! } : undefined;
}
