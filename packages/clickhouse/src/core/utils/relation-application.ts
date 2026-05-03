import type { SelectQueryNode } from '../../types/index.js';
import type { SchemaDefinition } from '../types/builder-state.js';
import type { JoinPath, JoinPathOptions, JoinRelationships } from '../join-relationships.js';
import { validateRelationAliasOverride, validateRelationPathOrigin } from './relation-validation.js';

export function resolveRelationPath<Schema extends SchemaDefinition<Schema>>(
  nameOrPath: string | JoinPath<Schema, string> | readonly JoinPath<Schema, string>[],
  relationships: JoinRelationships<Schema> | undefined
): { path: JoinPath<Schema, string> | readonly JoinPath<Schema, string>[]; label?: string } {
  if (typeof nameOrPath !== 'string') {
    return { path: nameOrPath };
  }

  if (!relationships) {
    throw new Error('Join relationships have not been initialized. Call QueryBuilder.setJoinRelationships first.');
  }

  const path = relationships.get(nameOrPath);
  if (!path) {
    throw new Error(`Join relationship '${nameOrPath}' not found`);
  }

  return { path, label: nameOrPath };
}

export function applyRelationPath<Schema extends SchemaDefinition<Schema>>(
  query: SelectQueryNode<any, Schema>,
  path: JoinPath<Schema, string> | readonly JoinPath<Schema, string>[],
  options: JoinPathOptions | undefined,
  appendJoin: (
    currentQuery: SelectQueryNode<any, Schema>,
    joinPath: JoinPath<Schema, string>,
    options: JoinPathOptions | undefined
  ) => SelectQueryNode<any, Schema>,
  label?: string
): SelectQueryNode<any, Schema> {
  validateRelationAliasOverride(path, options?.alias, label);
  validateRelationPathOrigin(query, path, label);

  return (Array.isArray(path) ? path : [path]).reduce(
    (currentQuery, joinPath) => appendJoin(currentQuery, joinPath, options),
    query
  );
}
