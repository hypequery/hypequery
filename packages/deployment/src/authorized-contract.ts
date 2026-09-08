/**
 * What one principal is allowed to see of a deployment contract.
 *
 * Discovery and execution must agree about who may reach what. The data plane
 * already decides that per call, from the endpoint policy on the target; a
 * gateway listing tools has to make the same decision over the whole contract,
 * before any call exists. Restating the rule there would put an authorization
 * predicate in two packages, and the copy that drifts is the one that leaks.
 *
 * The projection narrows, never widens: it can remove a target a principal may
 * not reach, and can never add one or loosen a policy. Feeding the result to
 * catalog projection or schema compilation therefore cannot advertise something
 * execution would refuse.
 */

import type {
  ProtocolAccessPolicy,
  ProtocolDatasetContract,
  ProtocolDeploymentContract,
  ProtocolEndpointPolicy,
} from '@hypequery/protocol';
import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import type { DeploymentDataPlanePrincipal } from './data-plane.js';
import { missing } from './utils/required-access.js';

/**
 * Whether a principal satisfies an access policy.
 *
 * Shares `missing` with the semantic data plane rather than restating it, which
 * is the whole point of this module existing in Core: one predicate, so
 * discovery cannot come to answer differently than execution.
 */
export function satisfiesDeploymentAccess(
  access: ProtocolAccessPolicy,
  principal: DeploymentDataPlanePrincipal | null,
): boolean {
  if (access.kind === 'public') return true;
  if (!principal) return false;
  return !missing(access.roles, principal.roles) && !missing(access.scopes, principal.scopes);
}

/** Whether a principal may reach a target published under this endpoint policy. */
export function isDeploymentEndpointAuthorized(
  endpoint: ProtocolEndpointPolicy | undefined,
  principal: DeploymentDataPlanePrincipal | null,
): boolean {
  // An absent endpoint is not a permissive one. A contract may describe a
  // dataset it never published, and an unpublished target is unreachable for
  // everyone — which is how the data plane's own target resolution reads it.
  return endpoint !== undefined && satisfiesDeploymentAccess(endpoint.access, principal);
}

interface RetainedDataset {
  readonly dataset: ProtocolDatasetContract;
  /** Published as a dataset target, rather than retained only to be joined to. */
  readonly published: boolean;
  readonly metrics: ProtocolDatasetContract['metrics'];
}

function retain(
  dataset: ProtocolDatasetContract,
  principal: DeploymentDataPlanePrincipal | null,
): RetainedDataset {
  return {
    dataset,
    published: isDeploymentEndpointAuthorized(dataset.endpoint, principal),
    // A metric carries its own endpoint and is resolved against it, so a metric
    // can be reachable on a dataset whose own endpoint the principal cannot
    // use — and unreachable on one it can.
    metrics: dataset.metrics.filter(metric => (
      isDeploymentEndpointAuthorized(metric.endpoint, principal)
    )),
  };
}

export interface AuthorizedDeploymentProjection {
  /**
   * A valid contract narrowed to what the principal may see, including any
   * dataset retained only to support a join or a named query.
   */
  readonly contract: ProtocolDeploymentContract;
  /**
   * The datasets the principal may address directly, in contract order.
   *
   * Always read this before advertising anything. `contract` is deliberately
   * wider: catalog projection and rehydration enumerate every dataset they are
   * given and neither consults an endpoint, so handing them the whole contract
   * would advertise a supporting dataset as queryable and disclose its
   * dimensions and measures to a principal with no access to it.
   *
   * The intended composition rehydrates the whole contract, so relationship
   * targets still resolve, and advertises only this subset:
   *
   * ```ts
   * const { contract, published } = projectAuthorizedDeploymentContract(active, principal);
   * const registry = rehydrateProtocolDatasets(contract.datasets, { onUnsupportedMetric: 'skip' });
   * const datasets = Object.fromEntries(published.map(name => [name, registry[name]]));
   * ```
   *
   * A joined dimension such as `orders.employee.id` still resolves through the
   * full registry, which is correct: that join is governed by the endpoint of
   * the dataset being queried, not by the target's.
   */
  readonly published: readonly string[];
}

/**
 * Projects the contract down to what `principal` may see.
 *
 * A dataset is *published* when the principal may address it directly, and
 * *supporting* when something published still needs it to stay coherent — the
 * target of a relationship, or the dataset a named query plans over. A
 * supporting dataset keeps its shape and loses its endpoint and metrics, so a
 * relationship can still be traversed exactly as execution would traverse it
 * while the dataset itself is not offered as a target.
 *
 * Dropping a relationship target instead would be the tempting alternative and
 * is wrong twice: it would invalidate any metric declaring a dimension across
 * that relationship, and it would advertise less than the data plane permits,
 * since a one-hop join is governed by the endpoint of the dataset being
 * queried, not by the target's.
 *
 * The two are returned separately rather than as one contract because nothing
 * downstream reads an endpoint. `projectAgentSafeCatalog` and
 * `rehydrateProtocolDatasets` enumerate whatever they are handed, so an
 * unpublished dataset left in the contract they see is an advertised one.
 *
 * The contract is revalidated. Callers hand it to catalog projection, schema
 * compilation, and rehydration, all of which assume a valid contract; a
 * projection that could emit an invalid one would move that failure to whatever
 * read it next.
 */
export function projectAuthorizedDeploymentContract(
  contract: ProtocolDeploymentContract,
  principal: DeploymentDataPlanePrincipal | null,
): AuthorizedDeploymentProjection {
  const byName = new Map(contract.datasets.map(dataset => [String(dataset.name), dataset]));
  const retained = new Map(contract.datasets.map(dataset => [
    String(dataset.name),
    retain(dataset, principal),
  ]));

  const queries = contract.queries.filter(query => (
    satisfiesDeploymentAccess(query.endpoint.access, principal)
  ));

  const required = new Set<string>();
  const require = (name: string) => {
    if (required.has(name) || !byName.has(name)) return;
    required.add(name);
    // Transitive: a retained target has relationships of its own, and every
    // target named in the contract has to still be there for it to validate.
    for (const relationship of byName.get(name)!.relationships) {
      require(String(relationship.target));
    }
  };
  for (const [name, entry] of retained) {
    if (entry.published || entry.metrics.length > 0) require(name);
  }
  for (const query of queries) {
    if (query.implementation.kind === 'semantic-plan') {
      require(String(query.implementation.query.dataset));
    }
  }

  const datasets = contract.datasets
    .filter(dataset => required.has(String(dataset.name)))
    .map(dataset => {
      const entry = retained.get(String(dataset.name))!;
      const { endpoint: _endpoint, ...rest } = dataset;
      return {
        ...rest,
        metrics: entry.metrics,
        ...(entry.published && dataset.endpoint !== undefined
          ? { endpoint: dataset.endpoint }
          : {}),
      };
    });

  return Object.freeze({
    contract: validateProtocolDeploymentContract({ ...contract, datasets, queries }),
    published: Object.freeze(datasets
      .filter(dataset => dataset.endpoint !== undefined)
      .map(dataset => String(dataset.name))),
  });
}
