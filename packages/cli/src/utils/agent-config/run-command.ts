import { spawnSync } from 'node:child_process';
import path from 'node:path';

export interface CommandRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

/** Characters `cmd.exe` would still interpret inside double quotes. */
const UNSAFE_FOR_CMD = /["%\r\n]/;

/**
 * The `cmd.exe` command line for a `.cmd`/`.bat` shim, each argument
 * double-quoted. Node refuses to spawn such shims directly, and `shell: true`
 * would join arguments unquoted; quoting each one keeps them separate. An
 * argument `cmd.exe` would expand even in quotes is refused.
 */
export function windowsShimCommandLine(executable: string, args: readonly string[]): string {
  const unsafe = [executable, ...args].find(value => UNSAFE_FOR_CMD.test(value));
  if (unsafe !== undefined) throw new Error(`Cannot pass ${JSON.stringify(unsafe)} safely through cmd.exe.`);
  return `"${[executable, ...args].map(value => `"${value}"`).join(' ')}"`;
}

/**
 * Run an agent's CLI (`codex`, `git`) without a shell and without stdin.
 * On Windows, npm installs CLIs as `.cmd` shims, which run through `cmd.exe`.
 */
export function runExecutable(
  executable: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly platform?: NodeJS.Platform; readonly env?: NodeJS.ProcessEnv } = {},
): CommandRun {
  const platform = options.platform ?? process.platform;
  const shim = platform === 'win32' && /\.(cmd|bat)$/i.test(path.extname(executable));
  let command = executable;
  let argv = [...args];
  if (shim) {
    try {
      argv = ['/d', '/s', '/c', windowsShimCommandLine(executable, args)];
    } catch (error) {
      return { status: null, stdout: '', stderr: '', error: error as Error };
    }
    command = (options.env ?? process.env).ComSpec ?? 'cmd.exe';
  }
  const result = spawnSync(command, argv, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    windowsVerbatimArguments: shim,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}
