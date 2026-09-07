import type { AnyDatasetInstance, RelationshipDefinition } from '../types.js';

/**
 * Resolves a published alias back to the materialized instance registered under
 * it. Deliberately a lookup rather than a value: relationships are rewired
 * while the registry is still being built, and datasets may reference each
 * other, so a target is resolved on call rather than at rewiring time.
 */
export type PublishedLookup = (alias: string) => AnyDatasetInstance | undefined;

/**
 * Maps each published dataset's defined name to the alias it was published
 * under. Keyed by name because that is the uniqueness the publisher enforces —
 * it rejects a second entry for the same dataset name — so a copied instance
 * still resolves to the right alias.
 */
export function publishedAliasesByName(
  entries: readonly { readonly alias: string; readonly dataset: AnyDatasetInstance }[],
): ReadonlyMap<string, string> {
  return new Map(entries.map(entry => [entry.dataset.name, entry.alias]));
}

/**
 * Rewires a dataset's relationships onto the aliases their targets were
 * published under.
 *
 * Publishing only renames the copied dataset, so without this a relationship's
 * `target()` closure still returns the original instance — a dataset published
 * as `accounts` would still be advertised as `customers` by everything that
 * relates to it, giving agents a target absent from the registry and a
 * reference the deployment contract validator rejects.
 *
 * A target that was not published is left untouched: the join still resolves
 * through the original instance, which is how an unpublished target already
 * behaves in a hand-built registry.
 */
export function rewirePublishedRelationships(
  relationships: Readonly<Record<string, RelationshipDefinition>>,
  aliasesByName: ReadonlyMap<string, string>,
  lookup: PublishedLookup,
): Record<string, RelationshipDefinition> {
  const rewired = Object.entries(relationships).map(([name, relationship]) => {
    const alias = aliasesByName.get(relationship.target().name);
    if (alias === undefined) return [name, relationship] as const;
    return [name, Object.freeze({
      ...relationship,
      target: () => lookup(alias) ?? relationship.target(),
    })] as const;
  });
  return Object.freeze(Object.fromEntries(rewired));
}
