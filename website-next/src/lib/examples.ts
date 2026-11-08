import registryJson from '@/data/examples-registry.json';

/**
 * The examples registry, generated from every example.json and recipe.json
 * under examples/ and recipes/ by `pnpm examples:registry` (see
 * packages/examples-schema). The website is an npm project outside the pnpm
 * workspace, so it reads the committed JSON instead of the manifests; lint
 * fails when the file is stale. Types here mirror the Zod schema.
 */
export type ManifestKind = 'example' | 'recipe';

export interface EnvVar {
  name: string;
  description: string;
  required: boolean;
}

export interface ManifestCore {
  slug: string;
  kind: ManifestKind;
  title: string;
  outcome: string;
  language: 'typescript' | 'python';
  stack: string[];
  useCases: string[];
  packages: string[];
  keyFile: string;
  env: EnvVar[];
  run: { install: string; dev: string; test: string };
  exampleRequest?: string;
  related: string[];
  leadPages: string[];
  functionPages: string[];
  keywords: string[];
  minVersion: string;
}

export interface ExampleManifest extends ManifestCore {
  kind: 'example';
}

export interface RecipeManifest extends ManifestCore {
  kind: 'recipe';
  datasetFile: string;
  expectedSqlFile: string;
  outputFile: string;
}

export type Manifest = ExampleManifest | RecipeManifest;

export interface SourceFile {
  path: string;
  language: string;
  source: string;
}

export interface RegistryEntry {
  manifest: Manifest;
  dir: string;
  readme: string;
  keyFile: SourceFile;
  recipe?: { dataset: SourceFile; expectedSql: string; output: string };
  screenshot?: string;
}

interface Registry {
  version: 1;
  entries: RegistryEntry[];
}

const registry = registryJson as unknown as Registry;

// The build, not a visitor, should hit a malformed registry.
if (registry.version !== 1 || !Array.isArray(registry.entries)) {
  throw new Error('examples-registry.json has an unexpected shape; run `pnpm examples:registry`');
}
for (const entry of registry.entries) {
  const m = entry.manifest;
  if (!m?.slug || !m.title || !m.outcome || (m.kind !== 'example' && m.kind !== 'recipe')) {
    throw new Error(`examples-registry.json entry ${entry.dir} is missing slug, title, outcome or kind`);
  }
}

export const registryEntries: readonly RegistryEntry[] = registry.entries;
export const examples = registryEntries.filter((e) => e.manifest.kind === 'example');
export const recipes = registryEntries.filter((e) => e.manifest.kind === 'recipe');

export const REPO_TREE_URL = 'https://github.com/hypequery/hypequery/tree/main';

export function kindPath(kind: ManifestKind): '/examples' | '/recipes' {
  return kind === 'example' ? '/examples' : '/recipes';
}

export function entryHref(entry: Pick<RegistryEntry, 'manifest'>): string {
  return `${kindPath(entry.manifest.kind)}/${entry.manifest.slug}`;
}

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

export interface Facets {
  stack: string[];
  useCases: string[];
  languages: string[];
}

export function collectFacets(entries: readonly RegistryEntry[]): Facets {
  const uniq = (values: string[]) => [...new Set(values)].sort();
  return {
    stack: uniq(entries.flatMap((e) => e.manifest.stack)),
    useCases: uniq(entries.flatMap((e) => e.manifest.useCases)),
    languages: uniq(entries.map((e) => e.manifest.language)),
  };
}

export interface FacetSelection {
  stack?: string | null;
  useCase?: string | null;
  language?: string | null;
}

export function filterEntries(entries: readonly RegistryEntry[], selection: FacetSelection): RegistryEntry[] {
  return entries.filter((e) => {
    if (selection.stack && !e.manifest.stack.includes(selection.stack)) return false;
    if (selection.useCase && !e.manifest.useCases.includes(selection.useCase)) return false;
    if (selection.language && e.manifest.language !== selection.language) return false;
    return true;
  });
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
  return body.trim();
}

/** The one-line `npx hypequery create` an agent or a person can paste. */
export function createCommand(entry: RegistryEntry): string {
  return `npx hypequery create ${entry.manifest.slug} -y`;
}

export const LABELS: Record<string, string> = {
  nextjs: 'Next.js',
  react: 'React',
  node: 'Node.js',
  clickhouse: 'ClickHouse',
  python: 'Python',
  typescript: 'TypeScript',
  'pre-aggregation': 'Pre-aggregation',
  dashboards: 'Dashboards',
  'time-series': 'Time series',
  'product-analytics': 'Product analytics',
  'embedded-analytics': 'Embedded analytics',
  'multi-tenant': 'Multi-tenant',
};

export function label(value: string): string {
  return LABELS[value] ?? value.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
