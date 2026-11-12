import type { ProtocolDeploymentDataset } from '@hypequery/protocol';

import { byName } from '../../utils/by-name.js';

/**
 * The order datasets are declared in: each after the targets of its to-one
 * relationships (`belongsTo`, `hasOne`), so TypeScript infers the target
 * first, ties by name. Datasets in a to-one cycle follow by name; the edges
 * that then point down the file are annotated where they're written.
 */
export function declarationOrder(
  datasets: readonly ProtocolDeploymentDataset[],
): ProtocolDeploymentDataset[] {
  const sorted = [...datasets].sort((left, right) => byName({ name: String(left.name) }, { name: String(right.name) }));
  const names = new Set(sorted.map(dataset => String(dataset.name)));
  const needs = new Map(sorted.map(dataset => [
    String(dataset.name),
    new Set(dataset.relationships
      .filter(item => item.kind !== 'hasMany' && String(item.target) !== String(dataset.name) && names.has(String(item.target)))
      .map(item => String(item.target))),
  ]));
  const placed = new Set<string>();
  const order: ProtocolDeploymentDataset[] = [];
  while (order.length < sorted.length) {
    const ready = sorted.find(dataset => !placed.has(String(dataset.name))
      && [...(needs.get(String(dataset.name)) ?? [])].every(target => placed.has(target)))
      // Only a cycle is left: take the first by name, and its edges are annotated.
      ?? sorted.find(dataset => !placed.has(String(dataset.name))) as ProtocolDeploymentDataset;
    placed.add(String(ready.name));
    order.push(ready);
  }
  return order;
}
