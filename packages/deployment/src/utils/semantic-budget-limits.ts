/** Drops explicitly-undefined properties, so a spread cannot erase a default. */
export function definedLimits<T extends object>(limits: T | undefined): Partial<T> {
  if (limits === undefined) return {};
  return Object.fromEntries(
    Object.entries(limits).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** The lowest of every ceiling that applies. A caller can tighten, never widen. */
export function lowest(...values: readonly (number | undefined)[]): number | undefined {
  const finite = values.filter((value): value is number => value !== undefined);
  return finite.length === 0 ? undefined : Math.min(...finite);
}

/** A declared ceiling under a server one; declaring nothing leaves the server's. */
export function tighten(declared: number | undefined, ceiling: number): number {
  return declared === undefined ? ceiling : Math.min(declared, ceiling);
}

