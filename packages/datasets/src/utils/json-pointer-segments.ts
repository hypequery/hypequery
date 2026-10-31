/**
 * An RFC 6901 pointer as path segments, item indexes as numbers, for zod
 * issues and wire `issues[].path`. Client-contract member names are
 * identifiers, so an all-digit segment is always an index.
 */
export function pointerSegments(pointer: string): (string | number)[] {
  return pointer.split('/').slice(1)
    .map(part => /^\d+$/.test(part) ? Number(part) : part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
