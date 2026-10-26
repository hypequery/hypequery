/**
 * `groupable: false` declares a dimension that backs filters or measures but
 * must not become a grouping key. The query schemas leave it out; the client
 * refuses it too, as the Python planner does.
 */
export function notGroupableError(name: string): string {
  return `Dimension "${name}" is not groupable.`;
}
