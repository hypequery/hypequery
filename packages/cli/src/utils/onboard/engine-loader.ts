import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError } from '../cli-error.js';
import { devDependencyInstallCommand, installDevDependency } from '../dependency-installer.js';
import { isUnattended } from '../input-mode.js';
import { logger } from '../logger.js';
import { isJsonOutput } from '../machine-output.js';
import { confirmInstallOnboardEngine } from '../prompts.js';
import { ONBOARD_ENGINE_SUBPATHS, type OnboardEngine, type OnboardEngineModules } from './engine-types.js';
import { satisfiesCaret } from './semver-caret.js';

export const ONBOARD_ENGINE_PACKAGE = '@hypequery/onboard-engine';
/**
 * The engine versions this CLI speaks to. The engine is released from the
 * hypequery Cloud repository on its own schedule (decision 0019 §5, amended);
 * any release in this range reaches CLI users without a CLI release.
 */
export const ONBOARD_ENGINE_RANGE = '^0.1.0';
const SPECIFIER = `${ONBOARD_ENGINE_PACKAGE}@${ONBOARD_ENGINE_RANGE}`;

/** The CLI package's own directory: `npx -p @hypequery/cli -p @hypequery/onboard-engine` installs both side by side. */
const CLI_DIRECTORY = fileURLToPath(new URL('../../../', import.meta.url));

interface EnginePackage {
  readonly directory: string;
  readonly version: string;
  readonly exports: unknown;
  readonly from: OnboardEngine['from'];
}

export interface EngineLoaderDependencies {
  /** The project to resolve from and install into (default: the working directory). */
  readonly cwd?: string;
  /** Where the CLI is installed; resolved second. */
  readonly cliDirectory?: string;
  readonly stdin?: { readonly isTTY?: boolean };
  readonly confirm?: (command: string) => Promise<boolean>;
  readonly install?: (specifier: string, directory: string) => Promise<boolean>;
  readonly installCommand?: (specifier: string, directory: string) => Promise<string[]>;
}

/** The engine's package.json as Node resolves it from `directory`, or undefined. */
async function findEngine(directory: string, from: OnboardEngine['from']): Promise<EnginePackage | undefined> {
  let manifestPath: string;
  try {
    manifestPath = createRequire(path.join(directory, 'package.json')).resolve(`${ONBOARD_ENGINE_PACKAGE}/package.json`);
  } catch {
    return undefined;
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: unknown; exports?: unknown };
  return {
    directory: path.dirname(manifestPath),
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    exports: manifest.exports,
    from,
  };
}

/**
 * A subpath's ESM file from the package's `exports` map, as Node would read
 * it for `import`. The engine's map is import-only, which `require.resolve`
 * can't follow, so the map is read here.
 */
export function exportTarget(exportsMap: unknown, subpath: string): string | undefined {
  if (!exportsMap || typeof exportsMap !== 'object') return undefined;
  const map = exportsMap as Record<string, unknown>;
  const key = `./${subpath}`;
  const pick = (entry: unknown, replacement?: string): string | undefined => {
    const target = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? ((entry as Record<string, unknown>).import ?? (entry as Record<string, unknown>).default)
        : undefined;
    if (typeof target !== 'string') return undefined;
    return replacement === undefined ? target : target.replaceAll('*', replacement);
  };
  if (key in map) return pick(map[key]);
  for (const [pattern, entry] of Object.entries(map)) {
    const star = pattern.indexOf('*');
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length) {
      return pick(entry, key.slice(prefix.length, key.length - suffix.length));
    }
  }
  return undefined;
}

async function importEngine(found: EnginePackage): Promise<OnboardEngine> {
  const entries = await Promise.all(ONBOARD_ENGINE_SUBPATHS.map(async (subpath) => {
    const target = exportTarget(found.exports, subpath);
    if (!target) {
      throw new CliError('ONBOARD_ENGINE_INCOMPATIBLE',
        `${ONBOARD_ENGINE_PACKAGE} ${found.version} has no "${subpath}" module, which this CLI needs. Install ${SPECIFIER}.`, {
          hint: `Install ${SPECIFIER}, or update @hypequery/cli.`,
          telemetryCode: 'not_installed',
        });
    }
    const url = pathToFileURL(path.resolve(found.directory, target)).href;
    return [subpath, await import(/* @vite-ignore */ url)] as const;
  }));
  return {
    version: found.version,
    directory: found.directory,
    from: found.from,
    modules: Object.fromEntries(entries) as unknown as OnboardEngineModules,
  };
}

function canOffer(stdin: { readonly isTTY?: boolean }, cwd: string): boolean {
  return stdin.isTTY === true && !isJsonOutput() && !isUnattended() && existsSync(path.join(cwd, 'package.json'));
}

/**
 * Load `@hypequery/onboard-engine` within {@link ONBOARD_ENGINE_RANGE}: from
 * the project's node_modules first, then from beside the CLI. When neither has
 * a compatible version, a person at a terminal is offered an install; under
 * `--json`, `--no-input`, CI or without a TTY the command fails with
 * `ONBOARD_ENGINE_MISSING` or `ONBOARD_ENGINE_INCOMPATIBLE`.
 */
export async function loadOnboardEngine(command: string, dependencies: EngineLoaderDependencies = {}): Promise<OnboardEngine> {
  const cwd = dependencies.cwd ?? process.cwd();
  const candidates = [
    await findEngine(cwd, 'project'),
    await findEngine(dependencies.cliDirectory ?? CLI_DIRECTORY, 'cli'),
  ].filter((found): found is EnginePackage => found !== undefined);
  const compatible = candidates.find(found => satisfiesCaret(found.version, ONBOARD_ENGINE_RANGE));
  if (compatible) return importEngine(compatible);

  const incompatible = candidates[0];
  const install = (dependencies.installCommand ?? devDependencyInstallCommand)(SPECIFIER, cwd);
  const manual = (await install).join(' ');
  const npx = `npx -p @hypequery/cli -p ${SPECIFIER} hypequery ${command}`;
  const problem = incompatible
    ? `\`hypequery ${command}\` needs ${SPECIFIER}, but ${incompatible.version} is installed (${incompatible.directory}).`
    : `\`hypequery ${command}\` needs ${SPECIFIER}, which is not installed.`;
  const options = {
    hint: `Run \`${manual}\` in the project, or run \`${npx}\`.`,
    telemetryCode: 'not_installed' as const,
  };

  if (canOffer(dependencies.stdin ?? process.stdin, cwd)) {
    logger.warn(problem);
    logger.info('The onboarding analysis engine is a separate package, released on its own schedule.');
    if (await (dependencies.confirm ?? confirmInstallOnboardEngine)(manual)) {
      if (await (dependencies.install ?? installDevDependency)(SPECIFIER, cwd)) {
        const installed = await findEngine(cwd, 'project');
        if (installed && satisfiesCaret(installed.version, ONBOARD_ENGINE_RANGE)) return importEngine(installed);
      }
    }
  }
  throw new CliError(
    incompatible ? 'ONBOARD_ENGINE_INCOMPATIBLE' : 'ONBOARD_ENGINE_MISSING',
    `${problem} Run \`${manual}\` in the project, or \`${npx}\`.`,
    options,
  );
}
