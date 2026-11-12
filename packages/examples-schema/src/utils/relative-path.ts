import path from 'node:path';

/**
 * A manifest file reference must stay inside the example folder: relative,
 * POSIX-separated, and never escaping with `..` or an absolute prefix.
 */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\')) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== '..' && !normalized.startsWith('../');
}
