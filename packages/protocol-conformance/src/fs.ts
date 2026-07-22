// The only module that touches the filesystem. Everything else operates on
// values injected from here, per Decision 0001's separation of pure contract
// logic from I/O.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ConformanceManifest } from './types.js';
import type { JsonLoader } from './manifest.js';

/**
 * Resolves the fixtures directory. When no explicit directory is given, prefer
 * the snapshot bundled with a published build (`../fixtures`), then fall back
 * to the in-repo source of truth so tests and local runs work without a build.
 */
export function resolveFixturesDir(explicit?: string): string {
  if (explicit !== undefined) return explicit;

  const bundled = fileURLToPath(new URL('../fixtures/', import.meta.url));
  if (existsSync(new URL('../fixtures/manifest.json', import.meta.url))) {
    return bundled;
  }
  return fileURLToPath(
    new URL('../../../specs/security-protocol/fixtures/', import.meta.url),
  );
}

function joinFixturePath(fixturesDir: string, relativePath: string): string {
  const base = fixturesDir.endsWith('/') ? fixturesDir : `${fixturesDir}/`;
  return `${base}${relativePath}`;
}

export function createJsonLoader(fixturesDir: string): JsonLoader {
  return (relativePath: string): unknown => {
    const path = joinFixturePath(fixturesDir, relativePath);
    return JSON.parse(readFileSync(path, 'utf8'));
  };
}

export function loadManifest(fixturesDir: string): ConformanceManifest {
  const manifest = JSON.parse(
    readFileSync(joinFixturePath(fixturesDir, 'manifest.json'), 'utf8'),
  ) as ConformanceManifest;
  if (manifest.kind !== 'hypequery-conformance-manifest') {
    throw new Error('manifest.json is not a hypequery conformance manifest');
  }
  return manifest;
}
