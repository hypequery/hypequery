import type { RelationshipDefinition, RelationshipKind, RelationshipJoin } from '../types.js';
import { normalizeRelationshipJoin } from './relationship-keys.js';

export function createRelationship<
  TTarget extends { __type: 'dataset'; name: string },
  TKind extends RelationshipKind,
>(
  kind: TKind,
  target: () => TTarget,
  join: RelationshipJoin,
): RelationshipDefinition<TTarget, TKind> {
  return {
    __type: 'relationship',
    kind,
    target,
    ...normalizeRelationshipJoin(join),
  };
}
