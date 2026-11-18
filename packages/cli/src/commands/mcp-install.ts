import { readFile } from 'node:fs/promises';
import {
  agentTarget,
  findExecutable,
  parseAgentClients,
  type AgentClient,
  type AgentEnvironment,
  type AgentScope,
  type AgentTarget,
} from '../utils/agent-config/clients.js';
import { AgentConfigError, editJsonServer, type JsonEditOutcome } from '../utils/agent-config/json-config.js';
import { codexEntry } from '../utils/agent-config/codex.js';
import { runExecutable, type CommandRun } from '../utils/agent-config/run-command.js';
import {
  CONFIGURED_BY_VALUE,
  CONFIGURED_BY_VARIABLE,
  HOSTED_MCP_URL,
  HOSTED_SERVER_NAME,
  LOCAL_SERVER_NAME,
  PROJECT_DIR_VARIABLE,
  hostedServerEntry,
  isManagedEntry,
  localServerCommand,
  localServerEntry,
  type LocalServerCommand,
} from '../utils/agent-config/server-entry.js';
import { getCliVersion } from '../utils/cli-version.js';
import { CliError } from '../utils/cli-error.js';
import { findDatasetsFile, findQueriesFile } from '../utils/find-files.js';
import { logger } from '../utils/logger.js';
import { emitResult } from '../utils/machine-output.js';

export interface McpInstallOptions {
  /** claude-code, cursor, codex, claude-desktop, a comma-separated list, all, or (default) the detected ones. */
  agent?: string;
  /** project (default for the local server) or user (default for --hosted). */
  scope?: string;
  /** Add the hosted hypequery app connector instead of the local server. */
  hosted?: boolean;
  /** Replace an entry with the same name that hypequery did not write. */
  force?: boolean;
  /** Report what would change without writing. */
  dryRun?: boolean;
  /** Remove the entry this command added. */
  remove?: boolean;
  /** Trusted tenant for tenant-scoped datasets, passed to `hypequery mcp --tenant`. */
  tenant?: string;
}

export type { CommandRun };

export interface McpInstallDependencies extends AgentEnvironment {
  readonly run?: (command: string, args: readonly string[]) => CommandRun;
  readonly serverCommand?: LocalServerCommand;
  /** Whether the project has a Serve API file for `hypequery mcp`; injected in tests. */
  readonly hasEntrypoint?: () => Promise<boolean>;
  /** Whether the project's datasets set a tenantKey; injected in tests. */
  readonly hasTenantDatasets?: () => Promise<boolean>;
}

export type McpInstallOutcome = JsonEditOutcome | 'skipped' | 'failed';

export interface McpInstallChange {
  readonly client: AgentClient;
  readonly scope: AgentScope | null;
  readonly file: string | null;
  readonly server: string;
  readonly outcome: McpInstallOutcome;
  readonly reason?: string;
}

function defaultRun(command: string, args: readonly string[]): CommandRun {
  return runExecutable(command, args);
}

/**
 * Whether the datasets file declares a `tenantKey`. `hypequery mcp` refuses to
 * serve tenant-scoped datasets without `--tenant`, so an install without one
 * would only add a server that fails to start.
 */
async function datasetsHaveTenantKey(): Promise<boolean> {
  const file = await findDatasetsFile();
  if (!file) return false;
  const source = await readFile(file, 'utf8').catch(() => '');
  return /\btenant(Key|_key)\s*[:=]/.test(source);
}

function parseScope(value: string | undefined, hosted: boolean): AgentScope {
  if (value === undefined) return hosted ? 'user' : 'project';
  if (value === 'project' || value === 'user') return value;
  throw new CliError('USAGE', `Unknown --scope ${value}; use project or user.`);
}

function commandFailure(run: CommandRun, what: string): string {
  if ((run.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return `${what}: the command is not on PATH.`;
  return `${what}: ${run.error?.message ?? (run.stderr.trim() || `exit code ${run.status ?? 'unknown'}`)}`;
}

/** Codex keeps servers in TOML, so it is changed through `codex mcp`. */
function codexChange(
  target: Extract<AgentTarget, { kind: 'command' }>,
  name: string,
  addArgs: readonly string[],
  options: McpInstallOptions,
  dependencies: McpInstallDependencies,
): JsonEditOutcome {
  const executable = findExecutable(target.executable, dependencies);
  if (!executable) throw new AgentConfigError('The `codex` command is not on PATH. Install the Codex CLI, or choose another --agent.', target.file);
  const run = dependencies.run ?? defaultRun;
  const current = run(executable, ['mcp', 'get', name, '--json']);
  const exists = current.status === 0;
  const entry = exists ? codexEntry(current.stdout) : undefined;
  const managed = exists && (entry ? isManagedEntry(entry) : current.stdout.includes(CONFIGURED_BY_VARIABLE) || current.stdout.includes(HOSTED_MCP_URL));
  if (exists && !managed && !options.force) {
    throw new AgentConfigError(
      `Codex already has an MCP server named "${name}" that hypequery did not write. Pass --force to replace it, or remove it first.`,
      target.file,
    );
  }
  if (options.remove && !exists) return 'absent';
  if (options.dryRun) return options.remove ? 'removed' : exists ? 'updated' : 'added';
  if (options.remove) {
    const removed = run(executable, ['mcp', 'remove', name]);
    if (removed.status !== 0) throw new AgentConfigError(commandFailure(removed, 'codex mcp remove failed'), target.file);
    return 'removed';
  }
  // `codex mcp add` replaces an entry of the same name in place, so a failed
  // update leaves the working entry as it was.
  const added = run(executable, ['mcp', 'add', name, ...addArgs]);
  if (added.status !== 0) throw new AgentConfigError(commandFailure(added, 'codex mcp add failed'), target.file);
  return exists ? 'updated' : 'added';
}

/**
 * `hypequery mcp:install`: add hypequery's MCP server to coding agents, so a
 * chat can use it without a hand-edited config. The local server runs
 * `hypequery mcp` in this project, with Node named by absolute path; the
 * project's `.env` keeps the ClickHouse credentials, which never go into an
 * agent's config. `--hosted` adds the hypequery app connector, which signs
 * in with OAuth.
 */
export async function mcpInstallCommand(options: McpInstallOptions = {}, dependencies: McpInstallDependencies = {}): Promise<McpInstallChange[]> {
  const hosted = options.hosted === true;
  const scope = parseScope(options.scope, hosted);
  let clients: AgentClient[];
  try {
    clients = parseAgentClients(options.agent, dependencies);
  } catch (error) {
    throw new CliError('USAGE', (error as Error).message);
  }
  if (clients.length === 0) {
    throw new CliError('NO_AGENT_FOUND', 'No coding agent was found on this machine (Claude Code, Cursor, Codex or Claude Desktop).', {
      hint: 'Pass --agent claude-code, cursor, codex or claude-desktop.',
    });
  }
  const projectDirectory = dependencies.cwd ?? process.cwd();
  const name = hosted ? HOSTED_SERVER_NAME : LOCAL_SERVER_NAME;
  const tenant = options.tenant?.trim();
  if (options.tenant !== undefined && !tenant) throw new CliError('USAGE', '--tenant needs a tenant id.');
  if (hosted && tenant) throw new CliError('USAGE', '--tenant applies to the local server; the hosted connector takes the tenant from your sign-in.');
  if (!hosted && !options.remove && !tenant && await (dependencies.hasTenantDatasets ?? datasetsHaveTenantKey)()) {
    throw new CliError('TENANT_REQUIRED', 'This project\'s datasets set tenantKey, so `hypequery mcp` needs a trusted tenant and would not start without one.', {
      hint: 'Pass --tenant <id> with the tenant the agent may query (for example your own test tenant).',
      telemetryCode: 'tenant_required',
    });
  }
  const baseCommand = hosted ? undefined : dependencies.serverCommand ?? localServerCommand({ projectDirectory, version: getCliVersion() });
  const command = baseCommand && tenant ? { ...baseCommand, args: [...baseCommand.args, '--tenant', tenant] } : baseCommand;

  const changes: McpInstallChange[] = [];
  for (const client of clients) {
    const target = agentTarget(client, scope, dependencies);
    if (!target) {
      changes.push({ client, scope: null, file: null, server: name, outcome: 'skipped', reason: 'Claude Desktop runs on macOS and Windows only.' });
      continue;
    }
    if (hosted && client === 'claude-desktop') {
      changes.push({
        client, scope: target.scope, file: target.file, server: name, outcome: 'skipped',
        reason: `Claude Desktop adds remote servers under Settings → Connectors; add ${HOSTED_MCP_URL} there.`,
      });
      continue;
    }
    try {
      let outcome: JsonEditOutcome;
      if (target.kind === 'command') {
        const addArgs = hosted
          ? ['--url', HOSTED_MCP_URL]
          : [
            '--env', `${PROJECT_DIR_VARIABLE}=${projectDirectory}`,
            '--env', `${CONFIGURED_BY_VARIABLE}=${CONFIGURED_BY_VALUE}`,
            '--', command!.command, ...command!.args,
          ];
        outcome = codexChange(target, name, addArgs, options, dependencies);
      } else {
        outcome = await editJsonServer({
          file: target.file,
          pointer: target.pointer,
          name,
          value: options.remove ? undefined : hosted ? hostedServerEntry(target.stdioType) : localServerEntry(command!, projectDirectory, target.stdioType),
          replaceable: current => isManagedEntry(current),
          force: options.force,
          dryRun: options.dryRun,
        });
      }
      changes.push({ client, scope: target.scope, file: target.file, server: name, outcome });
    } catch (error) {
      if (!(error instanceof AgentConfigError)) throw error;
      changes.push({ client, scope: target.scope, file: target.file, server: name, outcome: 'failed', reason: error.message });
    }
  }

  const prefix = options.dryRun ? 'Would have ' : '';
  for (const change of changes) {
    const where = change.file ? ` (${change.file})` : '';
    if (change.outcome === 'failed') logger.error(`${labelOf(change.client)}: ${change.reason}`);
    else if (change.outcome === 'skipped') logger.warn(`${labelOf(change.client)} skipped: ${change.reason}`);
    else if (change.outcome === 'unchanged' || change.outcome === 'absent') logger.info(`${labelOf(change.client)}: already up to date${where}`);
    else logger.success(`${prefix}${change.outcome} "${change.server}" for ${labelOf(change.client)}${where}`);
  }
  const warnings: string[] = [];
  if (hosted) {
    warnings.push(`The hosted connector (${HOSTED_MCP_URL}) signs in with OAuth the first time the agent uses it.`);
  } else if (!options.remove && !(await (dependencies.hasEntrypoint ?? (async () => (await findQueriesFile()) !== null))())) {
    warnings.push('This folder has no Serve API file yet (analytics/api.ts), so the server has nothing to serve. Run `hypequery next` for the step that creates one.');
  }
  for (const warning of warnings) logger.warn(warning);
  const changed = changes.some(change => ['added', 'updated', 'removed'].includes(change.outcome));
  if (changed && !options.dryRun) logger.info('Restart the agent (or start a new chat) so it loads the change.');
  emitResult({
    server: name,
    hosted,
    dryRun: options.dryRun === true,
    changes,
    warnings,
    next: changed && !options.dryRun ? 'Restart the agent or open a new chat, then run `hypequery next`.' : 'hypequery next',
  });
  if (changes.some(change => change.outcome === 'failed')) process.exitCode = 1;
  return changes;
}

function labelOf(client: AgentClient): string {
  return { 'claude-code': 'Claude Code', cursor: 'Cursor', codex: 'Codex', 'claude-desktop': 'Claude Desktop' }[client];
}
