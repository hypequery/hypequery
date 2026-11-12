export interface PinResolution {
  pins: Record<string, string>;
  /** Packages whose recorded version is not on npm yet, so the fallback tag is used. */
  unpublished: string[];
}

/**
 * The registry records the versions the examples were tested with. Those are
 * the right pins, but a version can be ahead of npm for a few minutes after
 * a release, or when the index was built from an unreleased commit. Check
 * each one and fall back to a dist-tag rather than scaffold a project whose
 * install cannot succeed.
 */
export async function resolvePins(
  packages: string[],
  recorded: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<PinResolution> {
  const pins: Record<string, string> = {};
  const unpublished: string[] = [];
  await Promise.all(
    packages.map(async (name) => {
      const version = recorded[name];
      if (!version) return;
      try {
        const response = await fetchImpl(`https://registry.npmjs.org/${name}/${version}`, { method: 'GET', headers: { accept: 'application/json' } });
        if (response.ok) pins[name] = version;
        else unpublished.push(name);
      } catch {
        unpublished.push(name);
      }
    }),
  );
  return { pins, unpublished };
}
