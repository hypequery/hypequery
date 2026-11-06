/** The command a bare `hypequery` runs in an interactive terminal. */
export const DEFAULT_COMMAND = 'init';

/** Root-level options that may accompany a bare invocation, e.g. `hypequery --no-telemetry`. */
const ROOT_OPTIONS: ReadonlySet<string> = new Set(['--no-telemetry']);

export interface DefaultCommandEnvironment {
  /** True when both stdin and stdout are attached to a terminal, so prompts can be answered. */
  readonly interactive: boolean;
}

/**
 * Routes a bare `hypequery` (no command, optionally with root options) to
 * `init` so first-time users land in setup instead of a help page.
 *
 * Only interactive terminals are routed: scripts, CI and piped invocations keep
 * printing help, because `init` would otherwise block on prompts nobody can
 * answer. Anything else — a command, `--help`, `--version`, unknown flags — is
 * returned unchanged so Commander handles it exactly as before.
 */
export function withDefaultCommand(args: readonly string[], env: DefaultCommandEnvironment): string[] {
  if (!env.interactive || !args.every(arg => ROOT_OPTIONS.has(arg))) return [...args];
  return [...args, DEFAULT_COMMAND];
}

export function isInteractiveTerminal(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean {
  return stdin.isTTY === true && stdout.isTTY === true;
}
