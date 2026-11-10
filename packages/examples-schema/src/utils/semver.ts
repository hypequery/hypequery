/** Strict `MAJOR.MINOR.PATCH` with an optional pre-release suffix (no build metadata). */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}
