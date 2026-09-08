---
"@hypequery/deployment": minor
---

Add `projectAuthorizedDeploymentContract()`, which narrows a deployment contract
to what one principal may see, plus the `satisfiesDeploymentAccess()` and
`isDeploymentEndpointAuthorized()` predicates it is built from.

It returns `{ contract, advertised, queryable }`, which are three different
things and all three are needed. `contract` is the narrowed contract, still
holding any dataset retained only to support a join or a named query.
`advertised` is what belongs in the catalog. `queryable` is what may be named as
a `query_dataset` target.

`advertised` is narrower than `contract.datasets` because
`projectAgentSafeCatalog` and `rehydrateProtocolDatasets` enumerate every
dataset they are handed and neither consults an endpoint, so advertising the
whole contract would disclose a supporting dataset's dimensions and measures to
a principal with no access to it. `queryable` is narrower than `advertised`
because a deployment authorizes a dataset and each of its metrics through
separate endpoint policies: a principal can hold a metric on a dataset it may
not query directly, and collapsing the two would either offer a target execution
refuses or hide a metric it would run.

A dataset reached only through its own metrics is also narrowed to what those
metrics expose — their declared dimensions and filters, the measures their
expressions can bind to, and the time field the planner needs. Execution already
confines a metric call to that surface, so advertising the containing dataset
whole would describe fields the caller was never granted. A dataset something published joins to keeps its *dimensions*, because a join
carries exactly those — each groupable one as `<relationship>.<name>`, each
filterable one under the full operator set — so they are genuinely reachable and
dropping one would both invalidate a metric declaring it across the join and
advertise less than execution accepts. Its measures and declared filters narrow
like any other, because a join never made them reachable.

Rehydrate `contract` so relationship targets still resolve, then pass
`advertised` as the registry and `queryable` as `queryableDatasets`.

Discovery and execution have to agree about who may reach what. The semantic
data plane already decides that per call from the endpoint policy on the target;
a gateway listing tools has to make the same decision across the whole contract,
before any call exists. Restating the rule there would put an authorization
predicate in two packages, and the copy that drifts is the one that leaks.

The projection narrows and never widens, so feeding the result to catalog
projection, schema compilation, or rehydration cannot advertise something
execution would refuse. A metric is filtered on its own endpoint rather than its
dataset's, because that is what the data plane resolves it against — a metric
can be reachable on a dataset the principal cannot address, and unreachable on
one it can.

A dataset needed to keep the result coherent — the target of a relationship, or
the dataset a retained named query plans over — is kept without its endpoint or
metrics rather than dropped. Dropping it would invalidate any metric declaring a
dimension across that relationship, and would advertise less than the data plane
permits, since a one-hop join is governed by the endpoint of the dataset being
queried rather than the target's. That is deliberate and it is what the data
plane already permits: a supporting dataset's fields stay reachable as
`<relationship>.<field>` on the dataset that joins to it, and hiding them would
advertise less than execution accepts. What the split prevents is the target
being offered as a target. An absent endpoint is read as unreachable rather than
unguarded, and the contract is revalidated before it is returned.
