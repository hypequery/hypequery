import type { SelectQueryNode } from '../../types/index.js';
import type { SchemaDefinition } from '../types/builder-state.js';
import type { JoinPath } from '../join-relationships.js';

function getAvailableRelationSources<Schema extends SchemaDefinition<Schema>>(
  query: SelectQueryNode<any, Schema>
): Set<string> {
  const sources = new Set<string>();
  if (query.from?.kind === 'table') {
    sources.add(query.from.name);
  }
  for (const join of query.joins || []) {
    sources.add(join.alias || join.table);
  }
  return sources;
}

export function validateRelationPathOrigin<Schema extends SchemaDefinition<Schema>>(
  query: SelectQueryNode<any, Schema>,
  path: JoinPath<Schema> | readonly JoinPath<Schema>[],
  label?: string
): void {
  const availableSources = getAvailableRelationSources(query);
  const paths = Array.isArray(path) ? path : [path];

  paths.forEach((joinPath, index) => {
    const from = String(joinPath.from);
    if (!availableSources.has(from)) {
      const relationshipLabel = label ? ` '${label}'` : '';
      throw new Error(
        `Join relationship${relationshipLabel} step ${index + 1} expects source '${from}', but available sources are: ${Array.from(availableSources).join(', ')}`
      );
    }

    availableSources.add(joinPath.alias || String(joinPath.to));
  });
}

export function validateRelationAliasOverride(
  path: JoinPath<any> | readonly JoinPath<any>[],
  alias: string | undefined,
  label?: string
): void {
  if (!Array.isArray(path) || !alias) {
    return;
  }

  const nameLabel = label ? `'${label}' ` : '';
  throw new Error(
    `Join relationship ${nameLabel}is a chain; alias override is only supported for single-join relationships`
  );
}
