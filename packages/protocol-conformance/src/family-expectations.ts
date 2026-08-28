/** Validates a release gate's independently maintained fixture-family list. */
export function validateExpectedFamilies(
  expectedFamilies: readonly string[],
  manifestFamilies: ReadonlySet<string>,
): void {
  if (
    expectedFamilies.some((family) => typeof family !== 'string' || family.length === 0)
    || new Set(expectedFamilies).size !== expectedFamilies.length
  ) {
    throw new Error('expected families must be unique non-empty strings');
  }
  const absent = expectedFamilies.filter((family) => !manifestFamilies.has(family)).sort();
  if (absent.length > 0) {
    throw new Error(`expected families are absent from the manifest: ${absent.join(', ')}`);
  }
}

/** Fails unless an adapter announces exactly the release gate's family set. */
export function assertExpectedFamilies(
  announcedFamilies: readonly string[],
  expectedFamilies: readonly string[] | undefined,
): void {
  if (!expectedFamilies) return;
  const announced = [...announcedFamilies].sort();
  const expected = [...expectedFamilies].sort();
  if (
    announced.length !== expected.length
    || announced.some((family, index) => family !== expected[index])
  ) {
    throw new Error(
      `adapter families did not match expectation: expected ${expected.join(', ') || '(none)'}; `
      + `announced ${announced.join(', ') || '(none)'}`,
    );
  }
}

/** Prevents a release gate from asserting families while filtering some out. */
export function assertSelectedFamilies(
  selectedFamilies: readonly string[] | undefined,
  expectedFamilies: readonly string[],
): void {
  if (!selectedFamilies) return;
  const selected = [...selectedFamilies].sort();
  const expected = [...expectedFamilies].sort();
  if (
    selected.length !== expected.length
    || selected.some((family, index) => family !== expected[index])
  ) {
    throw new Error(
      `selected families did not match expected families: expected `
      + `${expected.join(', ') || '(none)'}; selected ${selected.join(', ') || '(none)'}`,
    );
  }
}
