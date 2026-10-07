# Proposed owner-population execution rows

Owned by Proposed RFC 0017 and HQ-81. These synthetic rows are draft review
evidence, not accepted conformance fixtures. Do not register this directory in
the conformance manifest until protocol acceptance.

`rows.json` uses physical `(tenant, id)` primary keys. IDs collide across tenants,
distinct parents and children have equal measure values, and parents have unequal
child multiplicities. An orphan has NULL parent_id; one parent has no children;
some real children have NULL category, and one has an empty-string category
that must stay a separate group from NULL. Two sibling rows create a Cartesian
product with the first parent's children.

Expected rows pin tenant `a` results. NULL-group parent revenue includes both
unmatched parents and parents with actual NULL-category children. The grouped
parent totals intentionally sum to more than the ungrouped total, because a
parent can occur once in several groups. Child revenue excludes orphan and
foreign-tenant rows.

The live proof in `packages/datasets/src/tests/integration/` compares candidate
SQL with these expectations and independent owner-source queries, including
filtered/empty populations and both join_use_nulls settings. It deliberately
does not use or claim to implement the public hasMany planner.
