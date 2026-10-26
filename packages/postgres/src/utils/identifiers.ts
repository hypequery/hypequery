/** Quote one identifier with double quotes, doubling any embedded quote. */
export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Quote each part of a dotted name (`analytics.orders` → `"analytics"."orders"`). */
export function quotePostgresQualifiedName(name: string): string {
  return name.split('.').map(quotePostgresIdentifier).join('.');
}
