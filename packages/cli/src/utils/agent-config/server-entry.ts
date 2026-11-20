import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Marks MCP entries the CLI wrote, so it never replaces one a person wrote. */
export const CONFIGURED_BY_VARIABLE = 'HYPEQUERY_MCP_CONFIGURED_BY';
export const CONFIGURED_BY_VALUE = 'hypequery';
/** The project a local server runs in; the executable changes into it before loading `.env`. */
export const PROJECT_DIR_VARIABLE = 'HYPEQUERY_PROJECT_DIR';

/** The hypequery app connector (OAuth). */
export const HOSTED_MCP_URL = 'https://mcp.hypequery.com/mcp';
export const LOCAL_SERVER_NAME = 'hypequery';
export const HOSTED_SERVER_NAME = 'hypequery-cloud';

export interface LocalServerCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface ServerCommandInput {
  readonly projectDirectory: string;
  /** The running CLI script; defaults to `process.argv[1]`. */
  readonly cliPath?: string;
  readonly nodePath?: string;
  readonly version: string;
  readonly exists?: (file: string) => boolean;
  readonly realpath?: (file: string) => string;
  /** Resolves `@hypequery/cli`'s executable from the project; injected in tests. */
  readonly resolveFromProject?: (projectDirectory: string) => string | undefined;
}

function isTemporaryInstall(file: string): boolean {
  const normalized = file.replaceAll('\\', '/').toLowerCase();
  return normalized.includes('/_npx/') || normalized.includes('/.cache/pnpm/dlx/') || normalized.includes('/pnpm/dlx/');
}

/** The project's own `@hypequery/cli` executable, through its stable `node_modules` path. */
function projectCli(projectDirectory: string): string | undefined {
  try {
    const manifest = createRequire(path.join(projectDirectory, 'package.json')).resolve('@hypequery/cli/package.json');
    return path.join(path.dirname(manifest), 'dist', 'bin', 'cli.js');
  } catch {
    return undefined;
  }
}

/**
 * How an agent should launch `hypequery mcp` for this project. Node is named
 * by absolute path, because agents start servers without the shell's PATH
 * (nvm, fnm and Volta all put Node there). Prefer the project's own CLI through
 * `node_modules`, which survives upgrades; then the running CLI unless it is a
 * throwaway `npx` copy; else `npx` with this exact version.
 */
export function localServerCommand(input: ServerCommandInput): LocalServerCommand {
  const exists = input.exists ?? existsSync;
  const nodePath = input.nodePath ?? process.execPath;
  const fromProject = (input.resolveFromProject ?? projectCli)(input.projectDirectory);
  if (fromProject && exists(fromProject)) return { command: nodePath, args: [fromProject, 'mcp'] };
  const running = input.cliPath ?? process.argv[1];
  if (running && exists(running)) {
    const real = (input.realpath ?? realpathSync)(running);
    if (!isTemporaryInstall(real)) return { command: nodePath, args: [real, 'mcp'] };
  }
  const npx = path.join(path.dirname(nodePath), process.platform === 'win32' ? 'npx.cmd' : 'npx');
  return { command: exists(npx) ? npx : 'npx', args: ['-y', `@hypequery/cli@${input.version}`, 'mcp'] };
}

/** A JSON client's entry for the local stdio server. Credentials stay in the project's `.env`. */
export function localServerEntry(command: LocalServerCommand, projectDirectory: string, stdioType: boolean): Record<string, unknown> {
  return {
    ...(stdioType ? { type: 'stdio' } : {}),
    command: command.command,
    args: [...command.args],
    env: {
      [PROJECT_DIR_VARIABLE]: projectDirectory,
      [CONFIGURED_BY_VARIABLE]: CONFIGURED_BY_VALUE,
    },
  };
}

/** A JSON client's entry for the hosted connector. Claude Code needs `type`. */
export function hostedServerEntry(stdioType: boolean, url = HOSTED_MCP_URL): Record<string, unknown> {
  return stdioType ? { type: 'http', url } : { url };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether an existing entry is one this CLI wrote (so it may be replaced). */
export function isManagedEntry(value: unknown, url = HOSTED_MCP_URL): boolean {
  if (!isRecord(value)) return false;
  if (value.url === url) return true;
  return isRecord(value.env) && value.env[CONFIGURED_BY_VARIABLE] === CONFIGURED_BY_VALUE;
}

/** The files a local entry depends on, for `doctor`: they vanish when Node or the CLI is removed. */
export function entryExecutables(value: unknown): string[] {
  if (!isRecord(value) || typeof value.command !== 'string') return [];
  const files = [value.command];
  const first = Array.isArray(value.args) ? value.args[0] : undefined;
  if (typeof first === 'string' && path.isAbsolute(first)) files.push(first);
  return files.filter(file => path.isAbsolute(file));
}
