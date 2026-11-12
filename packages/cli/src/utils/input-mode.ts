/**
 * Whether anyone is there to answer. `--no-input` and CI mean nobody is: no
 * prompt, no wait for a browser (`login`), and no stdin for child processes
 * such as package installers. `--json` alone still allows a person to approve
 * in a browser, but never a terminal prompt.
 *
 * Only the executable decides this, from its flags and environment, before a
 * command runs; commands called directly (tests, embedders) stay attended.
 */
let unattended = false;

/** `CI=true`, `CI=1` or any other non-empty value except "0" and "false". */
export function isCiEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.CI?.trim().toLowerCase();
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** Set from the root `--no-input` flag and `CI` before a command runs. */
export function setUnattended(noInput: boolean, env: Readonly<Record<string, string | undefined>> = process.env): void {
  unattended = noInput || isCiEnvironment(env);
}

/** `--no-input` or CI under the executable: fail fast on anything that needs a person. */
export function isUnattended(): boolean {
  return unattended;
}
