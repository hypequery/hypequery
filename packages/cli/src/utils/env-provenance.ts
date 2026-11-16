/**
 * Which environment variables came from a project `.env*` file rather than
 * the real process environment.
 *
 * `bin/cli.ts` records the names set in the process environment before it
 * loads any env file. dotenv never overwrites a set variable, so a name that is
 * set now but was not then came from a file in the working directory. That
 * matters for credentials: a file in a cloned repository must not be able to
 * send a token from the shell to a server the repository chose.
 */
let shellVariableNames: ReadonlySet<string> | undefined;

/** Call once, before any env file is loaded. */
export function recordShellEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  shellVariableNames = new Set(Object.keys(env));
}

/**
 * The names an env file set. Empty when the shell environment was never
 * recorded (library use and tests), so nothing is treated as file-provided.
 */
export function envFileVariableNames(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const shell = shellVariableNames;
  if (!shell) return new Set();
  return new Set(Object.keys(env).filter(name => !shell.has(name)));
}

/** For tests: forget the recorded shell environment. */
export function resetShellEnvironment(): void {
  shellVariableNames = undefined;
}
