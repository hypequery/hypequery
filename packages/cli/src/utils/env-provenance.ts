/**
 * Which environment variables came from a project `.env*` file rather than
 * the real process environment.
 *
 * `bin/cli.ts` records the process environment (names and values) before it
 * loads any env file. A name that is set now but was not then, or whose value
 * has changed since, came from a file in the working directory. The env file
 * loader never overwrites a set variable, so a changed value is not expected.
 * It is still treated as file-provided, so that a loader that does overwrite
 * cannot make a file's value look like a shell value. That matters for
 * credentials: a file in a cloned repository must not be able to send a
 * token from the shell to a server the repository chose.
 */
let shellVariables: ReadonlyMap<string, string | undefined> | undefined;

/** Call once, before any env file is loaded. */
export function recordShellEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  shellVariables = new Map(Object.entries(env));
}

/**
 * The names an env file set or changed. Empty when the shell environment was
 * never recorded (library use and tests), so nothing is treated as
 * file-provided.
 */
export function envFileVariableNames(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlySet<string> {
  const shell = shellVariables;
  if (!shell) return new Set();
  return new Set(Object.keys(env).filter(name => !shell.has(name) || shell.get(name) !== env[name]));
}

/** For tests: forget the recorded shell environment. */
export function resetShellEnvironment(): void {
  shellVariables = undefined;
}
