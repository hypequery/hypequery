/**
 * The order protocol artifacts list named things in, so the same definitions
 * produce the same bytes whatever order they were supplied in. Python matches
 * it with `portable_name_key` (RFC 0002 names are ASCII).
 */
export function byName<T extends { readonly name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name);
}
