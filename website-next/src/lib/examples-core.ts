/**
 * Registry types and pure helpers, with no import of the registry JSON, so
 * client components can use them without shipping every README and key file
 * to the browser. Server code imports `@/lib/examples`, which re-exports these.
 */
export type ManifestKind = 'example' | 'recipe' | 'guide';

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

export interface GuideManifest {
  slug: string;
  kind: 'guide';
  title: string;
  outcome: string;
  clickhouseVersion: string;
  sqlFiles: string[];
  packages: string[];
  related: string[];
  leadPages: string[];
  functionPages: string[];
  keywords: string[];
}

export type Manifest = ExampleManifest | RecipeManifest | GuideManifest;

export interface SourceFile {
  path: string;
  language: string;
  source: string;
}

export interface RegistryEntry {
  manifest: Manifest;
  dir: string;
  /** README.md, or guide.md with its SQL includes expanded. */
  readme: string;
  /** Absent for guides. */
  keyFile?: SourceFile;
  recipe?: { dataset: SourceFile; expectedSql: string; output: string };
  guide?: { sqlFiles: Array<{ path: string; source: string }> };
  screenshot?: string;
}

export const REPO_TREE_URL = 'https://github.com/hypequery/hypequery/tree/main';

export function kindPath(kind: ManifestKind): '/examples' | '/recipes' | '/guides' {
  return kind === 'example' ? '/examples' : kind === 'recipe' ? '/recipes' : '/guides';
}

export function kindLabel(kind: ManifestKind, plural = false): string {
  const base = kind === 'example' ? 'Example' : kind === 'recipe' ? 'Recipe' : 'Guide';
  return plural ? `${base}s` : base;
}

/** Where a manifest's package is published: `@hypequery/*` on npm, `hypequery` on PyPI. */
export function packageUrl(pkg: string): string {
  return pkg === 'hypequery' ? 'https://pypi.org/project/hypequery/' : `https://www.npmjs.com/package/${pkg}`;
}

export function entryHref(entry: Pick<RegistryEntry, 'manifest'>): string {
  return `${kindPath(entry.manifest.kind)}/${entry.manifest.slug}`;
}

export interface Facets {
  stack: string[];
  useCases: string[];
  languages: string[];
}

export function collectFacets(entries: readonly Pick<RegistryEntry, 'manifest'>[]): Facets {
  const uniq = (values: string[]) => [...new Set(values)].sort();
  return {
    stack: uniq(entries.flatMap((e) => (e.manifest.kind === 'guide' ? [] : e.manifest.stack))),
    useCases: uniq(entries.flatMap((e) => (e.manifest.kind === 'guide' ? [] : e.manifest.useCases))),
    languages: uniq(entries.flatMap((e) => (e.manifest.kind === 'guide' ? [] : [e.manifest.language]))),
  };
}

export interface FacetSelection {
  stack?: string | null;
  useCase?: string | null;
  language?: string | null;
}

export function filterEntries<T extends Pick<RegistryEntry, 'manifest'>>(entries: readonly T[], selection: FacetSelection): T[] {
  return entries.filter((e) => {
    if (e.manifest.kind === 'guide') return !selection.stack && !selection.useCase && !selection.language;
    if (selection.stack && !e.manifest.stack.includes(selection.stack)) return false;
    if (selection.useCase && !e.manifest.useCases.includes(selection.useCase)) return false;
    if (selection.language && e.manifest.language !== selection.language) return false;
    return true;
  });
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
  chdb: 'chDB',
  fastapi: 'FastAPI',
  mcp: 'MCP',
  postgres: 'Postgres',
  api: 'API',
  'analytics-api': 'Analytics API',
  'ai-agents': 'AI agents',
  'saas-analytics': 'SaaS analytics',
  'postgres-to-clickhouse': 'Postgres to ClickHouse',
};

export function label(value: string): string {
  return LABELS[value] ?? value.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
