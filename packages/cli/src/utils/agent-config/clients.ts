import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The coding agents `hypequery mcp:install` can configure, and where each one
 * reads MCP servers from. Claude Code, Cursor and Claude Desktop keep a JSON
 * file; Codex has its own TOML, so it is changed through `codex mcp add`.
 */
export const AGENT_CLIENTS = ['claude-code', 'cursor', 'codex', 'claude-desktop'] as const;
export type AgentClient = typeof AGENT_CLIENTS[number];

/** `project` keeps the server to the current project; `user` makes it available everywhere. */
export type AgentScope = 'project' | 'user';

export interface AgentEnvironment {
  readonly home?: string;
  readonly cwd?: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly exists?: (file: string) => boolean;
}

interface BaseTarget {
  readonly client: AgentClient;
  readonly label: string;
  readonly scope: AgentScope;
}

/** A JSON file with `mcpServers`; `pointer` is where the object lives inside it. */
export interface JsonTarget extends BaseTarget {
  readonly kind: 'json';
  readonly file: string;
  readonly pointer: readonly string[];
  /** Claude Code wants `type: "stdio"` on local servers. */
  readonly stdioType: boolean;
}

/** A client changed through its own CLI. */
export interface CommandTarget extends BaseTarget {
  readonly kind: 'command';
  readonly executable: string;
  readonly file: string;
}

export type AgentTarget = JsonTarget | CommandTarget;

function resolved(environment: AgentEnvironment) {
  const platform = environment.platform ?? process.platform;
  return {
    home: environment.home ?? homedir(),
    cwd: environment.cwd ?? process.cwd(),
    platform,
    env: environment.env ?? process.env,
    exists: environment.exists ?? existsSync,
    join: platform === 'win32' ? path.win32.join : path.posix.join,
  };
}

function claudeDesktopFile(environment: ReturnType<typeof resolved>): string | undefined {
  const { home, platform, env, join } = environment;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return undefined;
}

/**
 * Where `client` keeps its MCP servers for `scope`. Scopes a client lacks
 * fall back to the one it has (Codex and Claude Desktop are user-wide only),
 * and the returned target says which scope it really is.
 */
export function agentTarget(client: AgentClient, scope: AgentScope, environment: AgentEnvironment = {}): AgentTarget | undefined {
  const resolvedEnvironment = resolved(environment);
  const { home, cwd, join } = resolvedEnvironment;
  switch (client) {
    case 'claude-code':
      // Claude Code's own "local" scope: this project only, kept out of the repository.
      return {
        kind: 'json',
        client,
        label: 'Claude Code',
        scope,
        file: join(home, '.claude.json'),
        pointer: scope === 'project' ? ['projects', cwd, 'mcpServers'] : ['mcpServers'],
        stdioType: true,
      };
    case 'cursor':
      return {
        kind: 'json',
        client,
        label: 'Cursor',
        scope,
        file: scope === 'project' ? join(cwd, '.cursor', 'mcp.json') : join(home, '.cursor', 'mcp.json'),
        pointer: ['mcpServers'],
        stdioType: false,
      };
    case 'codex':
      return { kind: 'command', client, label: 'Codex', scope: 'user', executable: 'codex', file: join(home, '.codex', 'config.toml') };
    case 'claude-desktop': {
      const file = claudeDesktopFile(resolvedEnvironment);
      return file
        ? { kind: 'json', client, label: 'Claude Desktop', scope: 'user', file, pointer: ['mcpServers'], stdioType: false }
        : undefined;
    }
  }
}

/** The absolute path of `command` on PATH, or next to this Node; undefined when neither has it. */
export function findExecutable(command: string, environment: AgentEnvironment & { nodePath?: string } = {}): string | undefined {
  const { platform, env, exists, join } = resolved(environment);
  const names = platform === 'win32' ? [`${command}.cmd`, `${command}.exe`, command] : [command];
  const directories = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const nodeDirectory = path.dirname(environment.nodePath ?? process.execPath);
  for (const directory of [...directories, nodeDirectory]) {
    for (const name of names) {
      const candidate = join(directory, name);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Agents that look installed on this machine. */
export function detectAgentClients(environment: AgentEnvironment = {}): AgentClient[] {
  const resolvedEnvironment = resolved(environment);
  const { home, platform, exists, join } = resolvedEnvironment;
  const onPath = (command: string) => findExecutable(command, environment) !== undefined;
  const detected: AgentClient[] = [];
  if (exists(join(home, '.claude.json')) || exists(join(home, '.claude')) || onPath('claude')) detected.push('claude-code');
  if (exists(join(home, '.cursor')) || (platform === 'darwin' && exists('/Applications/Cursor.app')) || onPath('cursor')) {
    detected.push('cursor');
  }
  if (onPath('codex')) detected.push('codex');
  const desktop = claudeDesktopFile(resolvedEnvironment);
  if (desktop && (exists(path.dirname(desktop)) || (platform === 'darwin' && exists('/Applications/Claude.app')))) {
    detected.push('claude-desktop');
  }
  return detected;
}

/** `--agent` as a list: one client, a comma-separated list, `all`, or (omitted) the detected ones. */
export function parseAgentClients(value: string | undefined, environment: AgentEnvironment = {}): AgentClient[] {
  if (value === undefined || value === 'detected') return detectAgentClients(environment);
  if (value === 'all') return [...AGENT_CLIENTS];
  const names = value.split(',').map(name => name.trim()).filter(Boolean).map(name => (name === 'claude' ? 'claude-code' : name));
  const unknown = names.filter(name => !(AGENT_CLIENTS as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown --agent ${unknown.join(', ')}; use ${AGENT_CLIENTS.join(', ')}, all or detected.`);
  }
  return [...new Set(names as AgentClient[])];
}
