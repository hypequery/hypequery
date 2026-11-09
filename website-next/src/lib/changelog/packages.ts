// The published packages whose CHANGELOG.md files feed /changelog. Order here is
// the display order of the package filter and the tie-break between releases
// published at the same moment.

export type ChangelogRegistry = 'npm' | 'pypi';

export interface ChangelogPackage {
  /** URL segment: /changelog/<slug>. */
  slug: string;
  /** Name as published to the registry. */
  name: string;
  /** Short label for filters and badges. */
  label: string;
  description: string;
  /** Path of the changelog relative to the repository root. */
  changelogPath: string;
  registry: ChangelogRegistry;
}

export const CHANGELOG_PACKAGES: readonly ChangelogPackage[] = [
  {
    slug: 'clickhouse',
    name: '@hypequery/clickhouse',
    label: 'clickhouse',
    description: 'Type-safe ClickHouse query builder and schema generator.',
    changelogPath: 'packages/clickhouse/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'datasets',
    name: '@hypequery/datasets',
    label: 'datasets',
    description: 'Code-first semantic layer: datasets, measures, and dimensions.',
    changelogPath: 'packages/datasets/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'serve',
    name: '@hypequery/serve',
    label: 'serve',
    description: 'Runtime for validated analytics APIs, OpenAPI, auth, and tenancy.',
    changelogPath: 'packages/serve/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'react',
    name: '@hypequery/react',
    label: 'react',
    description: 'Type-safe React and TanStack Query hooks.',
    changelogPath: 'packages/react/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'cli',
    name: '@hypequery/cli',
    label: 'cli',
    description: 'Scaffolding, type generation, and deployment commands.',
    changelogPath: 'packages/cli/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'mcp',
    name: '@hypequery/mcp',
    label: 'mcp',
    description: 'Governed MCP server that exposes datasets to agents.',
    changelogPath: 'packages/mcp-server/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'deployment',
    name: '@hypequery/deployment',
    label: 'deployment',
    description: 'Verified deployment intake, activation, and invocation.',
    changelogPath: 'packages/deployment/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'protocol',
    name: '@hypequery/protocol',
    label: 'protocol',
    description: 'Portable analytics contracts and reference implementation.',
    changelogPath: 'packages/protocol/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'protocol-conformance',
    name: '@hypequery/protocol-conformance',
    label: 'protocol-conformance',
    description: 'Cross-language conformance runner for the security protocol.',
    changelogPath: 'packages/protocol-conformance/CHANGELOG.md',
    registry: 'npm',
  },
  {
    slug: 'python',
    name: 'hypequery',
    label: 'python',
    description: 'The Python SDK and CLI.',
    changelogPath: 'python/hypequery/CHANGELOG.md',
    registry: 'pypi',
  },
];

export const changelogPackageBySlug: ReadonlyMap<string, ChangelogPackage> = new Map(
  CHANGELOG_PACKAGES.map((pkg) => [pkg.slug, pkg]),
);

/** Name shown on the site; the Python SDK is marked so it is not read as an npm package. */
export function packageDisplayName(pkg: ChangelogPackage): string {
  return pkg.registry === 'pypi' ? `${pkg.name} (Python)` : pkg.name;
}

export function registryUrl(pkg: ChangelogPackage): string {
  return pkg.registry === 'npm'
    ? `https://www.npmjs.com/package/${pkg.name}`
    : `https://pypi.org/project/${pkg.name}/`;
}
