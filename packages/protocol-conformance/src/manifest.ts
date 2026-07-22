// Pure enumeration of conformance cases from a parsed manifest. All file
// reading is injected as `loadJson` so this module has no I/O and can be unit
// tested with in-memory fixtures.
import type {
  ConformanceManifest,
  EnumeratedCase,
  ManifestFamily,
  ManifestFileEntry,
} from './types.js';

export type JsonLoader = (relativePath: string) => unknown;

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Minimal RFC 6901 JSON pointer resolution for the section selectors. */
export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON pointer: ${pointer}`);
  }
  let current: unknown = root;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodePointerToken(rawToken);
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`JSON pointer ${pointer} does not resolve`);
    }
  }
  return current;
}

function asCaseArray(value: unknown, context: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array of cases at ${context}`);
  }
  return value as Record<string, unknown>[];
}

function requireId(entry: Record<string, unknown>, context: string): string {
  const id = entry.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Fixture case at ${context} is missing a string id`);
  }
  return id;
}

function enumerateFile(
  family: ManifestFamily,
  file: ManifestFileEntry,
  loadJson: JsonLoader,
): EnumeratedCase[] {
  const data = loadJson(file.path);
  const cases: EnumeratedCase[] = [];

  const pushArray = (array: Record<string, unknown>[], section?: string): void => {
    for (const entry of array) {
      cases.push({
        family: family.name,
        role: file.role,
        id: requireId(entry, `${file.path}${section ?? ''}`),
        section,
        case: entry,
      });
    }
  };

  if (file.sections && file.sections.length > 0) {
    for (const section of file.sections) {
      pushArray(asCaseArray(resolveJsonPointer(data, section), `${file.path}${section}`), section);
    }
  } else {
    pushArray(asCaseArray(data, file.path));
  }

  return cases;
}

/** Cases derived from the family fixture files, in manifest order. */
export function enumerateFamilyCases(
  manifest: ConformanceManifest,
  loadJson: JsonLoader,
): EnumeratedCase[] {
  return manifest.families.flatMap((family) => {
    const cases = family.files.flatMap((file) => enumerateFile(family, file, loadJson));

    // An identity case pins the canonical bytes and hash of the success case
    // that shares its id. Attach that success value so an adapter can derive
    // the canonical form without loading the success file itself.
    const successValues = new Map<string, unknown>();
    for (const ec of cases) {
      if (ec.role === 'success') successValues.set(ec.id, ec.case.value);
    }
    return cases.map((ec) => {
      if (ec.role !== 'identity') return ec;
      if (!successValues.has(ec.id)) {
        throw new Error(`Identity case ${family.name}/${ec.id} has no matching success value`);
      }
      return { ...ec, case: { ...ec.case, value: successValues.get(ec.id) } };
    });
  });
}

/**
 * Cases derived from the fuzz corpus. A seed with its own `targets` fans out
 * to one case per target family; otherwise it uses the manifest entry family.
 */
export function enumerateFuzzCases(
  manifest: ConformanceManifest,
  loadJson: JsonLoader,
): EnumeratedCase[] {
  const cases: EnumeratedCase[] = [];
  for (const entry of manifest.fuzz) {
    const seeds = asCaseArray(loadJson(entry.path), entry.path);
    for (const seed of seeds) {
      const seedId = requireId(seed, entry.path);
      const targets = Array.isArray(seed.targets)
        ? (seed.targets as string[])
        : entry.family !== undefined
          ? [entry.family]
          : [];
      if (targets.length === 0) {
        throw new Error(`Fuzz seed ${seedId} in ${entry.path} has no target family`);
      }
      const fanOut = targets.length > 1;
      for (const family of targets) {
        cases.push({
          family,
          role: 'fuzz',
          id: fanOut ? `${seedId}@${family}` : seedId,
          case: seed,
        });
      }
    }
  }
  return cases;
}

export function enumerateAllCases(
  manifest: ConformanceManifest,
  loadJson: JsonLoader,
): EnumeratedCase[] {
  return [...enumerateFamilyCases(manifest, loadJson), ...enumerateFuzzCases(manifest, loadJson)];
}
