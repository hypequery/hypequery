---
"@hypequery/deployment": minor
---

Add `projectAuthorizedDeploymentContract()`, which narrows a deployment contract
to what one principal may see, plus the `satisfiesDeploymentAccess()` and
`isDeploymentEndpointAuthorized()` predicates it is built from.

It returns `{ contract, published }`. `contract` is the narrowed contract, which
still holds any dataset retained only to support a join or a named query;
`published` is the datasets the principal may address directly. Both are needed:
`projectAgentSafeCatalog` and `rehydrateProtocolDatasets` enumerate every
dataset they are handed and neither consults an endpoint, so advertising
`contract.datasets` would offer a supporting dataset as queryable and disclose
its dimensions and measures to a principal with no access to it. Rehydrate the
contract so relationship targets resolve, then advertise only `published`.

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
