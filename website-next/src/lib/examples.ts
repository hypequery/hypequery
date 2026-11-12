import registryJson from '@/data/examples-registry.json';
import { entryHref, REPO_TREE_URL, type ManifestKind, type RegistryEntry } from './examples-core';

export * from './examples-core';

/**
 * The examples registry, generated from every example.json and recipe.json
 * under examples/ and recipes/ by `pnpm examples:registry` (see
 * packages/examples-schema). The website is an npm project outside the pnpm
 * workspace, so it reads the committed JSON instead of the manifests; lint
 * fails when the file is stale. Types and pure helpers live in examples-core.ts.
 */

interface Registry {
  version: 1;
  packageVersions: Record<string, string>;
  entries: RegistryEntry[];
}

const registry = registryJson as unknown as Registry;

// The build, not a visitor, should hit a malformed registry.
if (registry.version !== 1 || !Array.isArray(registry.entries)) {
  throw new Error('examples-registry.json has an unexpected shape; run `pnpm examples:registry`');
}
for (const entry of registry.entries) {
  const m = entry.manifest;
  if (!m?.slug || !m.title || !m.outcome || (m.kind !== 'example' && m.kind !== 'recipe' && m.kind !== 'guide')) {
    throw new Error(`examples-registry.json entry ${entry.dir} is missing slug, title, outcome or kind`);
  }
}

export const registryEntries: readonly RegistryEntry[] = registry.entries;
/** `@hypequery/*` versions the examples were last tested against; `hypequery create` pins to these. */
export const packageVersions: Readonly<Record<string, string>> = registry.packageVersions ?? {};
export const examples = registryEntries.filter((e) => e.manifest.kind === 'example');
export const recipes = registryEntries.filter((e) => e.manifest.kind === 'recipe');
export const guides = registryEntries.filter((e) => e.manifest.kind === 'guide');

export function getEntry(kind: ManifestKind, slug: string): RegistryEntry | undefined {
  return registryEntries.find((e) => e.manifest.kind === kind && e.manifest.slug === slug);
}

export function getEntryBySlug(slug: string): RegistryEntry | undefined {
  return registryEntries.find((e) => e.manifest.slug === slug);
}

/** Entries whose block is injected into an existing lead page such as `/clickhouse-nextjs`. */
export function entriesForLeadPage(pathname: string): RegistryEntry[] {
  return registryEntries.filter((e) => e.manifest.leadPages.includes(pathname));
}

/** Entries tagged for a `/clickhouse/functions/<slug>` page. */
export function entriesForFunction(functionSlug: string): RegistryEntry[] {
  const wanted = functionSlug.toLowerCase();
  return registryEntries.filter((e) => e.manifest.functionPages.some((f) => f.toLowerCase() === wanted));
}

export function relatedEntries(entry: RegistryEntry): RegistryEntry[] {
  return entry.manifest.related.map((slug) => getEntryBySlug(slug)).filter((e): e is RegistryEntry => Boolean(e));
}

/**
 * The README body for the page: drop the H1 (the page renders the manifest
 * title) and the first paragraph when it repeats `outcome`, and point
 * relative links and images at site URLs.
 */
export function readmeBody(entry: RegistryEntry): string {
  let body = entry.readme.replace(/^\s*#\s[^\n]*\n+/, '');
  const firstParagraphEnd = body.indexOf('\n\n');
  const firstParagraph = (firstParagraphEnd === -1 ? body : body.slice(0, firstParagraphEnd)).trim();
  if (firstParagraph === entry.manifest.outcome.trim()) {
    body = firstParagraphEnd === -1 ? '' : body.slice(firstParagraphEnd + 2);
  }
  body = body.replace(/\]\(\.\.\/([a-z0-9-]+)\)/g, (match, slug: string) => {
    const target = getEntryBySlug(slug);
    return target ? `](${entryHref(target)})` : match;
  });
  if (entry.screenshot) {
    body = body.replace(/\]\(\.\/screenshot\.png\)/g, `](${entry.screenshot})`);
  }
  // Files inside the example (`./.mcp.json`) live on GitHub, not under the page URL.
  body = body.replace(/\]\(\.\/([^)\s]+)\)/g, (_m, file: string) => `](${REPO_TREE_URL}/${entry.dir}/${file})`);
  // Install steps as they run after `create` (the seed is copied to ./seed),
  // matching the CLI's rewriteReadmeForScaffold.
  body = body
    .replace(/\.\.\/examples\/_seed\/docker-compose\.yml/g, 'seed/docker-compose.yml')
    .replace(/&& pnpm seed\b/g, '&& (cd seed && pnpm install && pnpm seed)');
  return body.trim();
}

/** The one-line `npx @hypequery/cli create` an agent or a person can paste. */
/** Guides are read, not scaffolded; examples and recipes get a create command. */
export function createCommand(entry: RegistryEntry): string | null {
  return entry.manifest.kind === 'guide' ? null : `npx @hypequery/cli create ${entry.manifest.slug} -y`;
}

