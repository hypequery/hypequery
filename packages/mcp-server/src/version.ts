import { readFileSync } from 'node:fs';

interface PackageMetadata {
  readonly version?: unknown;
}

function readPackageVersion(): string {
  const metadata = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageMetadata;
  if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
    throw new Error('@hypequery/mcp package version is unavailable');
  }
  return metadata.version;
}

export const MCP_PACKAGE_VERSION = readPackageVersion();
