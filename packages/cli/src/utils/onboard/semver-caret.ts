/**
 * Whether `version` satisfies a caret range (`^1.2.3`, `^0.1.0`, `^0.0.3`),
 * as npm reads it: the leftmost non-zero part is fixed, the rest may only go
 * up. Prereleases never match, so a canary engine is opted into explicitly.
 * Only caret ranges are accepted; anything else is a programming error.
 */
export function satisfiesCaret(version: string, range: string): boolean {
  const base = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!base) throw new Error(`Unsupported range: ${range}`);
  const found = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!found) return false;
  const [major, minor, patch] = found.slice(1, 4).map(Number) as [number, number, number];
  const [baseMajor, baseMinor, basePatch] = base.slice(1, 4).map(Number) as [number, number, number];
  if (baseMajor > 0) {
    return major === baseMajor && (minor > baseMinor || (minor === baseMinor && patch >= basePatch));
  }
  if (baseMinor > 0) return major === 0 && minor === baseMinor && patch >= basePatch;
  return major === 0 && minor === 0 && patch === basePatch;
}
