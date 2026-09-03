const PUBLISHED_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate names that become public dataset, metric, tool, or schema identifiers. */
export function assertPublishedName(name: string, kind: 'dataset' | 'metric'): void {
  if (!PUBLISHED_NAME.test(name)) {
    throw new Error(
      `Published ${kind} name "${name}" must start with a letter or underscore and contain only letters, numbers, and underscores.`,
    );
  }
}
