/** RFC 6901: append *key* to the JSON pointer *path*. */
export function pointer(path: string, key: string): string {
  return `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}
