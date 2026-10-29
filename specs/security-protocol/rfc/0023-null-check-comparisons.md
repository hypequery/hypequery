# RFC 0023: Null-check comparisons

- Status: Proposed
- Version: null checks 1

A comparison can test a field for NULL. `isNull` and `isNotNull` are
comparison operators that take no right-hand value:

```json
{ "kind": "comparison", "operator": "isNotNull", "left": { "kind": "reference", "name": "churned_at" } }
```

Before this RFC every comparison compared `left` with a `right` value, so "has
a churn date" could only be approximated, for example as
`churned_at >= '1971-01-01'`, which is wrong for earlier dates and reads as a
real bound.

## Expressions (RFC 0003)

A `comparison` whose operator is `isNull` or `isNotNull` has exactly `kind`,
`operator` and `left`. A `right` member, of any value including a `null`
literal, fails with `HQ_EXPRESSION_INVALID_ARITY` at `$.right`; it is checked
before the other members. Every other comparison still requires `right`
(`HQ_EXPRESSION_TYPE` when absent). The operand may be any expression and any
field type: the grammar does not type it, and every type can hold NULL. A null
check is a comparison, so it is a predicate wherever predicates are allowed:
aggregate (measure) `filters`, semantic-query `filters`, `not`, `and` and `or`.
Both expression extensions 1 and 2 accept it.

## Deployment contracts (RFC 0006, RFC 0015)

A measure's fixed `filters` and a contract 3 segment `predicate` may use null
checks. A dataset filter's `operators` list may name `isNull` and `isNotNull`.
They take part in deployment identity like any other operator. A published
filter's list is unchanged unless its author lists a null check: implementations
must not add the null checks to the default list a filter publishes when its
definition names none, so existing deployments keep their identity.

## Client contracts and queries (RFC 0018)

`isNull` and `isNotNull` are allowed on every logical type, including boolean.
A client query filter using one is `{ "field": "...", "operator": "isNull" }`
and has no `value` member; a filter carrying one, `null` included, fails with
`HQ_CLIENT_QUERY`. A having condition cannot use them: measures are compared
with numbers.

## Datasets

Caller filters may use a null check only when the filter's definition lists
it in `operators`; the default allowlist (a filter with no list) is unchanged.
Measure fixed filters, segments and enforced constraints follow the same rules
they do for other operators. The planner renders `<field> IS NULL` and
`<field> IS NOT NULL`, through the query builder for query filters and as SQL
text for filtered aggregations. A null check on a time key is not converted to
the query timezone: it has no value to read in one.

## Compatibility

Older validators reject the new operators and the value-free shape. A contract,
query or invocation that uses one needs every consumer upgraded first; one that
does not is byte-identical to before. Fixtures live in
`fixtures/expressions-v1/`, `fixtures/deployments-v2/`,
`fixtures/deployments-v3/` and `fixtures/client-contract-v1/`, shared by the
TypeScript and Python validators.
