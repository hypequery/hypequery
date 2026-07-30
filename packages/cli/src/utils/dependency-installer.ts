import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

const ZOD_SCAFFOLD_VERSION = '^3.23.8';
// chdb/hypequery (the embedded adapter subpath) ships from chdb 3.2.0.
const CHDB_SCAFFOLD_VERSION = '^3.2.0';
const STABLE_SCAFFOLD_PACKAGES = ['@hypequery/clickhouse', '@hypequery/serve', `zod@${ZOD_SCAFFOLD_VERSION}`] as const;
type ScaffoldStyle = 'queries' | 'datasets';
type ScaffoldDatabase = 'clickhouse' | 'chdb';
const CLI_PACKAGE_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
};

const MANUAL_COMMANDS: Record<PackageManager, string> = {
  pnpm: 'pnpm add',
  yarn: 'yarn add',
  npm: 'npm install',
  bun: 'bun add',
};


function getDependencyVersion(pkg: PackageJson, name: string): string | undefined {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

function packageNameFromSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) {
    const atIndex = specifier.lastIndexOf('@');
    return atIndex > 0 ? specifier.slice(0, atIndex) : specifier;
  }

  const separatorIndex = specifier.indexOf('@', specifier.indexOf('/') + 1);
  return separatorIndex === -1 ? specifier : specifier.slice(0, separatorIndex);
}

async function readProjectPackageJson(): Promise<PackageJson | null> {
  try {
    const file = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
    return JSON.parse(file) as PackageJson;
  } catch {
    return null;
  }
}

async function readCliPackageJson(): Promise<PackageJson | null> {
  try {
    const file = await readFile(CLI_PACKAGE_PATH, 'utf8');
    return JSON.parse(file) as PackageJson;
  } catch {
    return null;
  }
}

function detectPackageManager(pkgJson: PackageJson | null): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.includes('pnpm')) return 'pnpm';
  if (userAgent.includes('yarn')) return 'yarn';
  if (userAgent.includes('bun')) return 'bun';

  const declared = pkgJson?.packageManager ?? '';
  if (declared.startsWith('pnpm')) return 'pnpm';
  if (declared.startsWith('yarn')) return 'yarn';
  if (declared.startsWith('bun')) return 'bun';

  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(cwd, 'bun.lockb'))) return 'bun';

  return 'npm';
}

export function isCanaryVersion(version: string | undefined): boolean {
  return version?.includes('canary') === true;
}

/**
 * Canary builds pin every hypequery package to a `0.0.0-canary-*` version, which
 * sorts below every published semver range. Any third-party peer range on a
 * hypequery package is therefore unsatisfiable — `chdb` declares
 * `peerOptional @hypequery/clickhouse@">=2.1.2"` — and npm aborts the whole
 * install with ERESOLVE, leaving the scaffold without its dependencies.
 *
 * Only npm needs this: pnpm (strict-peer-dependencies defaults to false), yarn
 * and bun all install through peer conflicts rather than failing. Stable
 * installs keep strict peer checking on every manager.
 */
function getPeerRelaxFlags(manager: PackageManager, canary: boolean): string[] {
  return canary && manager === 'npm' ? ['--legacy-peer-deps'] : [];
}

function getInstallArgs(manager: PackageManager, packages: string[], canary = false) {
  const relaxFlags = getPeerRelaxFlags(manager, canary);

  switch (manager) {
    case 'pnpm':
      return ['add', ...relaxFlags, ...packages];
    case 'yarn':
      return ['add', ...relaxFlags, ...packages];
    case 'bun':
      return ['add', ...relaxFlags, ...packages];
    case 'npm':
    default:
      return ['install', ...relaxFlags, ...packages];
  }
}

function formatManualCommand(manager: PackageManager, packages: string[], canary = false) {
  return [MANUAL_COMMANDS[manager], ...getPeerRelaxFlags(manager, canary), ...packages].join(' ');
}

export function resolveScaffoldPackages(
  cliVersion: string | undefined,
  style: ScaffoldStyle = 'queries',
  database: ScaffoldDatabase = 'clickhouse',
): string[] {
  const includeDatasets = style === 'datasets';
  const includeChdb = database === 'chdb';

  if (isCanaryVersion(cliVersion)) {
    return [
      `@hypequery/clickhouse@${cliVersion}`,
      `@hypequery/serve@${cliVersion}`,
      ...(includeDatasets ? [`@hypequery/datasets@${cliVersion}`] : []),
      `zod@${ZOD_SCAFFOLD_VERSION}`,
      ...(includeChdb ? [`chdb@${CHDB_SCAFFOLD_VERSION}`] : []),
    ];
  }

  return [
    ...STABLE_SCAFFOLD_PACKAGES,
    ...(includeDatasets ? ['@hypequery/datasets'] : []),
    ...(includeChdb ? [`chdb@${CHDB_SCAFFOLD_VERSION}`] : []),
  ];
}

function shouldInstallPackage(pkgJson: PackageJson, specifier: string): boolean {
  const name = packageNameFromSpecifier(specifier);
  const existingVersion = getDependencyVersion(pkgJson, name);

  if (!existingVersion) {
    return true;
  }

  const desiredHasPinnedVersion = specifier.startsWith('@')
    ? specifier.indexOf('@', specifier.indexOf('/') + 1) !== -1
    : specifier.includes('@');

  if (!desiredHasPinnedVersion) {
    return false;
  }

  const desiredVersion = specifier.slice(name.length + 1);
  return existingVersion !== desiredVersion;
}

export async function installScaffoldDependencies(
  style: ScaffoldStyle = 'queries',
  database: ScaffoldDatabase = 'clickhouse',
) {
  if (process.env.HYPEQUERY_SKIP_INSTALL === '1') {
    return;
  }

  const [pkgJson, cliPkgJson] = await Promise.all([
    readProjectPackageJson(),
    readCliPackageJson(),
  ]);
  if (!pkgJson) {
    const packages = [
      '@hypequery/clickhouse',
      '@hypequery/serve',
      ...(style === 'datasets' ? ['@hypequery/datasets'] : []),
      'zod',
      ...(database === 'chdb' ? ['chdb'] : []),
    ];
    logger.warn(`package.json not found. Install ${packages.join(', ')} manually.`);
    return;
  }

  const requestedPackages = resolveScaffoldPackages(cliPkgJson?.version, style, database);
  const missing = requestedPackages.filter(pkg => shouldInstallPackage(pkgJson, pkg));
  if (missing.length === 0) {
    return;
  }

  const canary = isCanaryVersion(cliPkgJson?.version);
  const manager = detectPackageManager(pkgJson);
  const command = manager === 'npm' ? 'npm' : manager;
  const args = getInstallArgs(manager, missing, canary);

  logger.info(`Installing ${missing.join(', ')} with ${manager}...`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}`));
        }
      });
    });
    logger.success(`Installed ${missing.join(', ')}`);
  } catch (error) {
    logger.warn('Failed to install hypequery packages automatically.');
    logger.info(`Run manually: ${formatManualCommand(manager, missing, canary)}`);
    if (error instanceof Error && error.message) {
      logger.info(error.message);
    }
  }
}

export const installServeDependencies = installScaffoldDependencies;
