import path from 'node:path';
import { COMMON_PROPERTIES, EVENT_SCHEMA_VERSION } from './catalog.js';
import { HYPEQUERY_PACKAGES, DATABASES } from './domains.js';
import type { Properties } from './schema.js';
import { matchesTelemetryFormat } from './value-formats.js';
import { readPackage, readTelemetryFile, type ProjectContext, type ReadLocalFile } from './project-context.js';
import { detectDatabaseFromEnvironment } from '../detect-database-environment.js';
import { performance } from 'node:perf_hooks';

type Common = Properties<typeof COMMON_PROPERTIES>;
export const CI_SIGNALS = [
  ['GITHUB_ACTIONS', 'github_actions'], ['GITLAB_CI', 'gitlab'], ['CIRCLECI', 'circleci'],
  ['BUILDKITE', 'buildkite'], ['JENKINS_URL', 'jenkins'], ['VERCEL', 'vercel'],
  ['NETLIFY', 'netlify'], ['TF_BUILD', 'azure'], ['BITBUCKET_BUILD_NUMBER', 'bitbucket'],
  ['TEAMCITY_VERSION', 'teamcity'], ['TRAVIS', 'travis'], ['CODEBUILD_BUILD_ID', 'codebuild'],
] as const;

export function ciContext(env: Readonly<Record<string, string | undefined>>): Pick<Common, 'is_ci' | 'ci_name'> {
  const match = CI_SIGNALS.find(([key]) => env[key] && env[key] !== 'false' && env[key] !== '0');
  const ci = !!match || !!(env.CI && env.CI !== 'false' && env.CI !== '0');
  return { is_ci: ci, ci_name: match?.[1] ?? (ci ? 'unknown' : 'none') };
}

export function packageManagerContext(
  env: Readonly<Record<string, string | undefined>>,
  executable: string,
): Pick<Common, 'package_manager' | 'package_manager_major' | 'invoked_via'> {
  const match = env.npm_config_user_agent?.match(/^(npm|pnpm|yarn|bun)\/(\d{1,3})(?:\.|\s|$)/);
  const executableManager = env.npm_execpath?.replace(/\\/g, '/').split('/').pop()?.match(/^(npm-cli|pnpm|yarn|bun)(?:[-.].*)?$/)?.[1];
  const manager = (match?.[1] ?? (executableManager === 'npm-cli' ? 'npm' : executableManager)) as Common['package_manager'] | undefined;
  const script = executable.replace(/\\/g, '/');
  const invoked: Common['invoked_via'] = /\/_npx\//.test(script) ? 'npx'
    : /(?:\/dlx\/|\/dlx-)/.test(script) && manager === 'pnpm' ? 'pnpm_dlx'
    : env.npm_command === 'exec' && manager === 'npm' ? 'npx'
    : manager === 'bun' && /(?:bunx|\.bun\/install\/cache)/.test(script) ? 'bunx'
    : /(?:\/lib\/node_modules\/|\/bin\/hypequery(?:\.js)?$)/.test(script) ? 'global'
    : /\/node_modules\/(?:\.bin\/|@hypequery\/cli\/)/.test(script) ? 'local_bin' : 'unknown';
  return { package_manager: manager ?? 'unknown', ...(match ? { package_manager_major: match[2] } : {}), invoked_via: invoked };
}

export function installedPackages(context: ProjectContext, read: ReadLocalFile): Common['hypequery_packages'] {
  const result: NonNullable<Common['hypequery_packages']> = {};
  const pkg = context.package;
  if (!pkg || !context.directory) return undefined;
  for (const name of HYPEQUERY_PACKAGES) {
    const declared = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]
      .some(section => !!section && typeof section === 'object' && Object.hasOwn(section, name));
    if (!declared) continue;
    const locations = [...new Set([context.directory, context.rootDirectory].filter((directory): directory is string => !!directory))];
    const resolved = locations.map(directory => readPackage(path.join(directory, 'node_modules', name, 'package.json'), read)?.version)
      .find(version => matchesTelemetryFormat('version', version));
    const sections = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies];
    const spec = sections.map(section => (section as Record<string, unknown> | undefined)?.[name]).find(value => typeof value === 'string');
    // Dependency specs are never forwarded. Only a validated exact release is eligible.
    result[name] = matchesTelemetryFormat('version', resolved) ? resolved as string
      : matchesTelemetryFormat('version', spec) ? spec as string : 'unknown';
  }
  return Object.keys(result).length ? result : undefined;
}

export function environmentDatabase(env: Readonly<Record<string, string | undefined>>, context: ProjectContext): Common['database'] {
  const detected = detectDatabaseFromEnvironment(env);
  if (detected) return detected;
  const pkg = context.package;
  if ([pkg?.dependencies, pkg?.devDependencies].some(section => !!section && typeof section === 'object' && Object.hasOwn(section, 'chdb'))) return 'chdb';
  return 'unknown';
}

export interface EnvironmentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly read?: ReadLocalFile;
  readonly platform?: string;
  readonly arch?: string;
  readonly nodeVersion?: string;
  readonly cliVersion?: string;
  readonly executable?: string;
  readonly isTTY?: boolean;
  readonly database?: string;
  /** Monotonic clock for the local-read budget. Defaults to `performance.now`. */
  readonly now?: () => number;
}

/** Total wall-clock budget for local file probes; telemetry must never slow the CLI. */
export const READ_BUDGET_MS = 5;

export function collectEnvironment(context: ProjectContext, options: EnvironmentOptions = {}): Omit<Common, 'install_id' | 'session_id' | 'project_id' | 'is_first_run'> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + READ_BUDGET_MS;
  const read: ReadLocalFile = file => {
    if (now() >= deadline) return undefined;
    try { return (options.read ?? readTelemetryFile)(file); } catch { return undefined; }
  };
  const os = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const node = (options.nodeVersion ?? process.versions.node).split('.').slice(0, 2).join('.');
  const packages = installedPackages(context, read);
  const docker = read('/.dockerenv') !== undefined || /(?:docker|containerd|kubepods)/.test(read('/proc/1/cgroup') ?? '');
  const wsl = !!env.WSL_DISTRO_NAME || /microsoft/i.test(read('/proc/sys/kernel/osrelease') ?? '');
  return {
    schema_version: EVENT_SCHEMA_VERSION,
    cli_version: matchesTelemetryFormat('version', options.cliVersion) ? options.cliVersion! : 'unknown',
    node_version: matchesTelemetryFormat('node_version', node) ? node : 'unknown',
    os: (COMMON_PROPERTIES.os.values as readonly string[]).includes(os) ? os as Common['os'] : 'unknown',
    arch: (COMMON_PROPERTIES.arch.values as readonly string[]).includes(arch) ? arch as Common['arch'] : 'unknown',
    ...ciContext(env), is_tty: options.isTTY ?? !!process.stderr.isTTY, is_docker: docker, is_wsl: wsl,
    ...packageManagerContext(env, options.executable ?? process.argv[1] ?? ''),
    ...(packages ? { hypequery_packages: packages } : {}),
    database: (DATABASES as readonly string[]).includes(options.database ?? '') ? options.database as Common['database'] : environmentDatabase(env, context),
  };
}
