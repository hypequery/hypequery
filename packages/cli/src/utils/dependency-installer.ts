import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger.js';

const REQUIRED_PACKAGES = ['@hypequery/clickhouse', '@hypequery/serve'];

type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

type PackageJson = {
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

function hasDependency(pkg: PackageJson, name: string) {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

async function readProjectPackageJson(): Promise<PackageJson | null> {
  try {
    const file = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
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

function getInstallArgs(manager: PackageManager, packages: string[]) {
  switch (manager) {
    case 'pnpm':
      return ['add', ...packages];
    case 'yarn':
      return ['add', ...packages];
    case 'bun':
      return ['add', ...packages];
    case 'npm':
    default:
      return ['install', ...packages];
  }
}

function formatManualCommand(manager: PackageManager, packages: string[]) {
  return `${MANUAL_COMMANDS[manager]} ${packages.join(' ')}`;
}

export async function installServeDependencies() {
  if (process.env.HYPEQUERY_SKIP_INSTALL === '1') {
    return;
  }

  const pkgJson = await readProjectPackageJson();
  if (!pkgJson) {
    logger.warn('package.json not found. Install @hypequery/clickhouse and @hypequery/serve manually.');
    return;
  }

  const missing = REQUIRED_PACKAGES.filter(pkg => !hasDependency(pkgJson, pkg));
  if (missing.length === 0) {
    return;
  }

  const manager = detectPackageManager(pkgJson);
  const command = manager === 'npm' ? 'npm' : manager;
  const args = getInstallArgs(manager, missing);

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
    logger.info(`Run manually: ${formatManualCommand(manager, missing)}`);
    if (error instanceof Error && error.message) {
      logger.info(error.message);
    }
  }
}
