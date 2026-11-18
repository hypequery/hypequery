import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ClickHouseLogLevel, createClient } from '@clickhouse/client';
import { AGENT_SKILLS } from '../../templates/skills.generated.js';
import {
  agentTarget,
  detectAgentClients,
  findExecutable,
  type AgentClient,
  type AgentEnvironment,
} from '../agent-config/clients.js';
import { readJsonConfig, serversAt } from '../agent-config/json-config.js';
import { codexEntry } from '../agent-config/codex.js';
import { runExecutable } from '../agent-config/run-command.js';
import {
  CONFIGURED_BY_VARIABLE,
  HOSTED_SERVER_NAME,
  LOCAL_SERVER_NAME,
  PROJECT_DIR_VARIABLE,
  entryExecutables,
} from '../agent-config/server-entry.js';
import { getClickHouseConfigFromEnv } from '../clickhouse-client.js';
import { getCliVersion } from '../cli-version.js';
import { loadCloudCredential } from '../cloud-credential-store.js';
import { describeConnectionError } from '../connection-error.js';
import { envFileVariableNames } from '../env-provenance.js';
import { findDatasetsFile, findQueriesFile } from '../find-files.js';
import { loadManagementCredential } from '../management-token-store.js';
import { isSupportedNode, MINIMUM_NODE_VERSION } from '../node-version.js';
import { redactConnectionUrl } from '../redact-connection-url.js';

/**
 * What `doctor`, `next` and `start` know about this machine and project. It
 * holds no secret: never a password or token, only whether one is set.
 */
export interface SetupState {
  readonly node: { readonly version: string; readonly minimum: string; readonly supported: boolean };
  readonly cli: { readonly version: string; readonly inProject: boolean };
  readonly cloud: {
    readonly signedIn: boolean;
    readonly source: 'env' | 'management-token' | 'deploy-credential' | null;
    readonly expiresAt: string | null;
    readonly unreadable: boolean;
  };
  readonly connection: {
    readonly configured: boolean;
    readonly url: string | null;
    readonly database: string | null;
    readonly username: string | null;
    readonly passwordSet: boolean;
    /** Whether the settings came from a project `.env*` file. */
    readonly fromEnvFile: boolean;
    /** null when not tested (no settings, or `probe: false`). */
    readonly reachable: boolean | null;
    readonly error: string | null;
    /** ClickHouse's `readonly` setting for this user: true when it cannot write; null when unknown. */
    readonly readOnly: boolean | null;
  };
  readonly envFile: {
    readonly exists: boolean;
    /** null when there is no git repository to ask. */
    readonly gitIgnored: boolean | null;
    /** Other users can read it (POSIX permission bits). */
    readonly worldReadable: boolean;
  };
  readonly project: {
    readonly directory: string;
    readonly packageJson: boolean;
    readonly apiFile: string | null;
    readonly datasetsFile: string | null;
    readonly mcpPackage: boolean;
  };
  readonly agents: readonly AgentState[];
  readonly skills: { readonly user: SkillsState; readonly project: SkillsState };
}

export type SkillsState = 'current' | 'outdated' | 'missing';

export interface AgentState {
  readonly client: AgentClient;
  readonly servers: readonly ServerState[];
  readonly error: string | null;
}

export interface ServerState {
  readonly name: string;
  readonly scope: 'project' | 'user';
  readonly file: string;
  readonly kind: 'local' | 'hosted' | 'other';
  readonly managed: boolean;
  /** Absolute files the entry launches that no longer exist. */
  readonly missingExecutables: readonly string[];
  /** The project a local entry serves, when it names one. */
  readonly projectDirectory: string | null;
}

export interface CollectOptions extends AgentEnvironment {
  /** Connect to ClickHouse to check the settings (doctor, next); off for quick checks. */
  readonly probe?: boolean;
  readonly probeConnection?: (config: NonNullable<ReturnType<typeof getClickHouseConfigFromEnv>>) => Promise<{ readOnly: boolean | null }>;
  readonly loadManagement?: typeof loadManagementCredential;
  readonly loadDeploy?: typeof loadCloudCredential;
  readonly run?: (command: string, args: readonly string[], cwd: string) => { status: number | null; stdout: string };
  readonly now?: () => number;
}

function defaultRun(command: string, args: readonly string[], cwd: string) {
  return runExecutable(command, args, { cwd });
}

/** `SELECT getSetting('readonly')`: also proves the URL, user and password work. */
async function probeClickHouse(config: NonNullable<ReturnType<typeof getClickHouseConfigFromEnv>>): Promise<{ readOnly: boolean | null }> {
  const client = createClient({ ...config, request_timeout: 8_000, log: { level: ClickHouseLogLevel.OFF } });
  try {
    const result = await client.query({ query: "SELECT getSetting('readonly') AS readonly", format: 'JSONEachRow' });
    const rows = await result.json<{ readonly: string | number }>();
    const value = rows[0]?.readonly;
    return { readOnly: value === undefined ? null : Number(value) > 0 };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function cloudState(options: CollectOptions, env: Readonly<Record<string, string | undefined>>): Promise<SetupState['cloud']> {
  if (env.HYPEQUERY_API_TOKEN?.trim()) return { signedIn: true, source: 'env', expiresAt: null, unreadable: false };
  const now = (options.now ?? Date.now)();
  let unreadable = false;
  try {
    const management = await (options.loadManagement ?? loadManagementCredential)();
    if (management && Date.parse(management.expiresAt) > now) {
      return { signedIn: true, source: 'management-token', expiresAt: management.expiresAt, unreadable: false };
    }
  } catch {
    unreadable = true;
  }
  try {
    const deploy = await (options.loadDeploy ?? loadCloudCredential)();
    if (deploy && Date.parse(deploy.expiresAt) > now) return { signedIn: true, source: 'deploy-credential', expiresAt: deploy.expiresAt, unreadable };
  } catch {
    unreadable = true;
  }
  return { signedIn: false, source: null, expiresAt: null, unreadable };
}

async function connectionState(options: CollectOptions): Promise<SetupState['connection']> {
  const config = getClickHouseConfigFromEnv();
  const fromFile = envFileVariableNames();
  const base = {
    configured: config !== null,
    url: config ? redactConnectionUrl(config.url) : null,
    database: config?.database ?? null,
    username: config?.username ?? null,
    passwordSet: Boolean(config?.password),
    fromEnvFile: ['CLICKHOUSE_URL', 'CLICKHOUSE_HOST', 'CLICKHOUSE_PASSWORD'].some(name => fromFile.has(name)),
  };
  if (!config || options.probe === false) return { ...base, reachable: null, error: null, readOnly: null };
  try {
    const { readOnly } = await (options.probeConnection ?? probeClickHouse)(config);
    return { ...base, reachable: true, error: null, readOnly };
  } catch (error) {
    return { ...base, reachable: false, error: describeConnectionError(error), readOnly: null };
  }
}

function envFileState(directory: string, options: CollectOptions): SetupState['envFile'] {
  const file = path.join(directory, '.env');
  if (!existsSync(file)) return { exists: false, gitIgnored: null, worldReadable: false };
  const platform = options.platform ?? process.platform;
  const worldReadable = platform !== 'win32' && (statSync(file).mode & 0o044) !== 0;
  const git = findExecutable('git', options);
  let gitIgnored: boolean | null = null;
  if (git) {
    const run = options.run ?? defaultRun;
    const inside = run(git, ['rev-parse', '--is-inside-work-tree'], directory);
    if (inside.status === 0) gitIgnored = run(git, ['check-ignore', '-q', '.env'], directory).status === 0;
  }
  return { exists: true, gitIgnored, worldReadable };
}

function projectState(directory: string, apiFile: string | null, datasetsFile: string | null): SetupState['project'] {
  const packageJson = path.join(directory, 'package.json');
  const resolves = (specifier: string) => {
    try {
      createRequire(packageJson).resolve(specifier);
      return true;
    } catch {
      return false;
    }
  };
  return {
    directory,
    packageJson: existsSync(packageJson),
    apiFile,
    datasetsFile,
    mcpPackage: resolves('@hypequery/mcp'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serverState(name: string, value: unknown, scope: 'project' | 'user', file: string, exists: (file: string) => boolean): ServerState {
  const record = isRecord(value) ? value : {};
  const env = isRecord(record.env) ? record.env : {};
  const hosted = typeof record.url === 'string';
  const projectDirectory = typeof env[PROJECT_DIR_VARIABLE] === 'string' ? env[PROJECT_DIR_VARIABLE] as string : null;
  return {
    name,
    scope,
    file,
    kind: hosted ? 'hosted' : typeof record.command === 'string' ? 'local' : 'other',
    managed: hosted || env[CONFIGURED_BY_VARIABLE] !== undefined,
    missingExecutables: entryExecutables(value).filter(executable => !exists(executable)),
    projectDirectory,
  };
}

/** hypequery's MCP entries in each agent's config, for this project and user-wide. */
async function agentStates(options: CollectOptions, directory: string): Promise<AgentState[]> {
  const exists = options.exists ?? existsSync;
  const states: AgentState[] = [];
  for (const client of detectAgentClients(options)) {
    const servers: ServerState[] = [];
    let error: string | null = null;
    try {
      if (client === 'codex') {
        const codex = findExecutable('codex', options);
        const run = options.run ?? defaultRun;
        for (const name of [LOCAL_SERVER_NAME, HOSTED_SERVER_NAME]) {
          if (!codex) break;
          const result = run(codex, ['mcp', 'get', name, '--json'], directory);
          if (result.status !== 0) continue;
          const entry = codexEntry(result.stdout);
          const file = agentTarget('codex', 'user', options)!.file;
          servers.push(entry
            ? serverState(name, entry, 'user', file, exists)
            : {
              name, scope: 'user', file, kind: name === HOSTED_SERVER_NAME ? 'hosted' : 'local',
              managed: result.stdout.includes(CONFIGURED_BY_VARIABLE), missingExecutables: [], projectDirectory: null,
            });
        }
      } else {
        const seen = new Set<string>();
        for (const scope of ['project', 'user'] as const) {
          const target = agentTarget(client, scope, { ...options, cwd: directory });
          if (!target || target.kind !== 'json' || target.scope !== scope) continue;
          const key = `${target.file}#${target.pointer.join('.')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const { config } = await readJsonConfig(target.file);
          const entries = serversAt(config, target.pointer, target.file) ?? {};
          for (const name of [LOCAL_SERVER_NAME, HOSTED_SERVER_NAME]) {
            if (entries[name] !== undefined) servers.push(serverState(name, entries[name], scope, target.file, exists));
          }
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    states.push({ client, servers, error });
  }
  return states;
}

function skillsState(root: string): SkillsState {
  let missing = 0;
  let outdated = 0;
  for (const skill of AGENT_SKILLS) {
    const file = path.join(root, '.claude', 'skills', skill.name, 'SKILL.md');
    if (!existsSync(file)) missing += 1;
    else if (readFileSync(file, 'utf8') !== skill.content) outdated += 1;
  }
  if (missing === AGENT_SKILLS.length) return 'missing';
  return missing + outdated === 0 ? 'current' : 'outdated';
}

/** Read everything `doctor` reports and `next` decides from. Never throws for a broken setup: that is what it reports. */
export async function collectSetupState(options: CollectOptions = {}): Promise<SetupState> {
  const directory = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const [cloud, connection, apiFile, datasetsFile, agents] = await Promise.all([
    cloudState(options, env),
    connectionState(options),
    findQueriesFile(),
    findDatasetsFile(),
    agentStates(options, directory),
  ]);
  const project = projectState(directory, apiFile, datasetsFile);
  let inProject = false;
  try {
    createRequire(path.join(directory, 'package.json')).resolve('@hypequery/cli/package.json');
    inProject = true;
  } catch {
    // Not installed in this project.
  }
  return {
    node: { version: process.version.replace(/^v/, ''), minimum: MINIMUM_NODE_VERSION, supported: isSupportedNode() },
    cli: { version: getCliVersion(), inProject },
    cloud,
    connection,
    envFile: envFileState(directory, options),
    project,
    agents,
    skills: { user: skillsState(options.home ?? (await import('node:os')).homedir()), project: skillsState(directory) },
  };
}

/** The local MCP entries that serve this project, across agents. */
export function projectServers(state: SetupState): ServerState[] {
  // A broken entry (its Node or CLI is gone) serves nothing: `next` must send it back to mcp:install.
  return state.agents.flatMap(agent => agent.servers).filter(server => server.kind === 'local'
    && server.missingExecutables.length === 0
    && (server.projectDirectory === null || path.resolve(server.projectDirectory) === path.resolve(state.project.directory)));
}
