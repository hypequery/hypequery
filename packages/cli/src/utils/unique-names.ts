/**
 * Gives every name a distinct spelling, in order: the first holder of a name
 * keeps it, and each later one takes the lowest free numeric suffix
 * (`pickupCity2`). A suffixed spelling never takes a name that appears in the
 * list as given, so a later entry is never displaced by an earlier rename.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const given = new Set(names);
  const taken = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let suffix = 2; taken.has(candidate) || (candidate !== name && given.has(candidate)); suffix += 1) {
      candidate = `${name}${suffix}`;
    }
    taken.add(candidate);
    return candidate;
  });
}
