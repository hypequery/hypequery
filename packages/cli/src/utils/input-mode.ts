/**
 * Whether anyone is there to answer. `--no-input` and CI mean nobody is: no
 * prompt, and no wait for a browser (`login`). `--json` alone still allows a
 * person to approve in a browser, but never a terminal prompt.
 */
let noInput = false;

/** Set from the root `--no-input` flag before a command runs. */
export function setNoInput(value: boolean): void {
  noInput = value;
}

/** `CI=true`, `CI=1` or any other non-empty value except "0" and "false". */
export function isCiEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.CI?.trim().toLowerCase();
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** `--no-input` or CI: fail fast on anything that needs a person. */
export function isUnattended(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return noInput || isCiEnvironment(env);
}
