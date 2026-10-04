/**
 * Candidate owner-population SQL for RFC 0016 review. Test-only, fixed fixture
 * schema: this is not a production compiler or accepted execution capability.
 */
export interface FanoutProofOptions {
  grouped?: boolean;
  childFilter?: boolean;
  fixedChildFilter?: boolean;
  siblings?: boolean;
  empty?: boolean;
  allTenants?: boolean;
  joinUseNulls?: 0 | 1;
}

export const FANOUT_PROOF_TABLES = {
  parents: 'hq81_proof_parents',
  children: 'hq81_proof_children',
  siblings: 'hq81_proof_siblings',
} as const;

/** Deduplicate owner keys per group before joining back to their original values. */
export function fanoutProofSql(options: FanoutProofOptions = {}): string {
  const { parents, children, siblings } = FANOUT_PROOF_TABLES;
  const scope = options.empty ? "tenant = 'missing'" : options.allTenants ? '1' : "tenant = 'a'";
  // A nullable group key is encoded without losing the distinction between
  // NULL and an actual empty string. Group joins compare this non-NULL tuple.
  const group = options.grouped ? "tuple(toUInt8(isNull(c.category)), ifNull(c.category, ''))" : "tuple(toUInt8(0), '')";
  return `WITH
    parents AS (SELECT * FROM ${parents} WHERE ${scope}),
    children AS (SELECT *, toNullable(1) AS matched FROM ${children} WHERE ${scope}),
    siblings AS (SELECT *, toNullable(1) AS matched FROM ${siblings} WHERE ${scope}),
    membership AS (
      SELECT ${group} AS grp,
        p.tenant AS parent_tenant, p.id AS parent_id,
        c.tenant AS child_tenant, c.id AS child_id, c.matched AS child_match
        ${options.siblings ? ', s.tenant AS sibling_tenant, s.id AS sibling_id, s.matched AS sibling_match' : ''}
      FROM parents AS p
      LEFT ALL JOIN children AS c ON p.tenant = c.tenant AND p.id = c.parent_id
      ${options.siblings ? 'LEFT ALL JOIN siblings AS s ON p.tenant = s.tenant AND p.id = s.parent_id' : ''}
      ${options.childFilter ? "WHERE c.category = 'red' AND isNotNull(c.matched)" : ''}
    ),
    parent_keys AS (SELECT DISTINCT grp, parent_tenant, parent_id FROM membership),
    child_keys AS (SELECT DISTINCT grp, child_tenant, child_id FROM membership WHERE isNotNull(child_match)),
    parent_values AS (
      SELECT k.grp AS grp, sum(p.amount) AS parent_sum, count() AS parent_count, avg(p.amount) AS parent_avg, toNullable(1) AS matched
      FROM parent_keys AS k INNER ALL JOIN parents AS p
        ON k.parent_tenant = p.tenant AND k.parent_id = p.id GROUP BY k.grp
    ),
    child_values AS (
      SELECT k.grp AS grp, sum(c.amount) AS child_sum, count() AS child_count, toNullable(1) AS matched
      FROM child_keys AS k INNER ALL JOIN children AS c
        ON k.child_tenant = c.tenant AND k.child_id = c.id
      ${options.fixedChildFilter ? "WHERE c.category = 'red'" : ''} GROUP BY k.grp
    )
    ${options.siblings ? `,
    sibling_keys AS (SELECT DISTINCT grp, sibling_tenant, sibling_id FROM membership WHERE isNotNull(sibling_match)),
    sibling_values AS (
      SELECT k.grp AS grp, sum(s.amount) AS sibling_sum, toNullable(1) AS matched
      FROM sibling_keys AS k INNER ALL JOIN siblings AS s
        ON k.sibling_tenant = s.tenant AND k.sibling_id = s.id GROUP BY k.grp
    )` : ''}
    SELECT ${options.grouped ? 'if(g.grp.1 = 1, NULL, toNullable(g.grp.2)) AS category,' : ''}
      if(isNotNull(p.matched), toNullable(p.parent_sum), NULL) AS parent_sum,
      if(isNotNull(p.matched), p.parent_count, toUInt64(0)) AS parent_count,
      if(isNotNull(p.matched), toNullable(p.parent_avg), NULL) AS parent_avg,
      if(isNotNull(c.matched), toNullable(c.child_sum), NULL) AS child_sum,
      if(isNotNull(c.matched), c.child_count, toUInt64(0)) AS child_count
      ${options.siblings ? ', if(isNotNull(s.matched), toNullable(s.sibling_sum), NULL) AS sibling_sum' : ''}
    FROM (${options.grouped ? 'SELECT DISTINCT grp FROM membership' : "SELECT tuple(toUInt8(0), '') AS grp"}) AS g
    LEFT ALL JOIN parent_values AS p ON g.grp = p.grp
    LEFT ALL JOIN child_values AS c ON g.grp = c.grp
    ${options.siblings ? 'LEFT ALL JOIN sibling_values AS s ON g.grp = s.grp' : ''}
    ORDER BY g.grp
    SETTINGS join_use_nulls = ${options.joinUseNulls ?? 0}, output_format_json_quote_64bit_integers = 0`;
}
