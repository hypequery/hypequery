import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createJsonLoader, loadManifest } from './fs.js';
import { enumerateAllCases, enumerateFamilyCases, resolveJsonPointer } from './manifest.js';
import type { EnumeratedCase } from './types.js';

const fixturesDir = fileURLToPath(
  new URL('../../../specs/security-protocol/fixtures/', import.meta.url),
);
const manifest = loadManifest(fixturesDir);
const loadJson = createJsonLoader(fixturesDir);

function fixtureFamilyDirs(): string[] {
  return readdirSync(fixturesDir)
    .filter((entry) => statSync(`${fixturesDir}${entry}`).isDirectory())
    .filter((entry) => entry !== 'fuzz-seeds-v1');
}

describe('conformance manifest completeness', () => {
  it('covers every family fixture directory', () => {
    const declared = new Set(manifest.families.map((family) => family.name));
    for (const dir of fixtureFamilyDirs()) {
      expect(declared, `family ${dir} is missing from the manifest`).toContain(dir);
    }
    expect(manifest.families.length).toBe(fixtureFamilyDirs().length);
  });

  it('covers every .json file in each family directory exactly once', () => {
    for (const family of manifest.families) {
      const dir = `${fixturesDir}${family.name}`;
      const jsonFiles = readdirSync(dir).filter((name) => name.endsWith('.json'));
      const covered = family.files.map((file) => file.path.split('/').pop());
      expect([...covered].sort()).toEqual([...jsonFiles].sort());
      expect(new Set(covered).size).toBe(covered.length);
    }
  });

  it('resolves every manifest path and section', () => {
    for (const family of manifest.families) {
      for (const file of family.files) {
        const data = loadJson(file.path);
        if (file.sections) {
          for (const section of file.sections) {
            expect(Array.isArray(resolveJsonPointer(data, section))).toBe(true);
          }
        } else {
          expect(Array.isArray(data)).toBe(true);
        }
      }
    }
  });

  it('gives every family case a unique id per role', () => {
    const seen = new Map<string, Set<string>>();
    for (const ec of enumerateFamilyCases(manifest, loadJson)) {
      const key = `${ec.family}/${ec.role}`;
      const ids = seen.get(key) ?? new Set<string>();
      expect(ids, `duplicate id ${ec.id} in ${key}`).not.toContain(ec.id);
      ids.add(ec.id);
      seen.set(key, ids);
    }
  });

  it('matches every rejection and non-portable code to a family prefix', () => {
    const byFamily = new Map(manifest.families.map((family) => [family.name, family.codePrefixes]));
    const codeOf = (ec: EnumeratedCase): string | undefined =>
      ec.role === 'rejection'
        ? (ec.case.error as string)
        : ec.role === 'non-portable'
          ? (ec.case.code as string)
          : undefined;

    for (const ec of enumerateFamilyCases(manifest, loadJson)) {
      const code = codeOf(ec);
      if (code === undefined) continue;
      const prefixes = byFamily.get(ec.family) ?? [];
      expect(prefixes.some((prefix) => code.startsWith(prefix)), `${code} in ${ec.family}`).toBe(true);
    }
  });

  it('pairs every identity case with a success value', () => {
    const identityCases = enumerateFamilyCases(manifest, loadJson).filter((ec) => ec.role === 'identity');
    expect(identityCases.length).toBeGreaterThan(0);
    for (const ec of identityCases) {
      expect(ec.case.value, `identity ${ec.family}/${ec.id} has no success value`).toBeDefined();
    }
  });

  it('enumerates fuzz seeds against real target families', () => {
    const familyNames = new Set(manifest.families.map((family) => family.name));
    const fuzzCases = enumerateAllCases(manifest, loadJson).filter((ec) => ec.role === 'fuzz');
    expect(fuzzCases.length).toBeGreaterThan(0);
    for (const ec of fuzzCases) {
      expect(familyNames, `fuzz target ${ec.family}`).toContain(ec.family);
    }
  });
});
