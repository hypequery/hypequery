import { CliError } from './cli-error.js';

/** How the current command talks to its caller. */
export interface OutputMode {
  /** `--json`: one JSON document on stdout, everything else on stderr. */
  readonly json: boolean;
  /** Whether the command may prompt. False without a terminal, with --json, --no-input, --yes or CI. */
  readonly interactive: boolean;
  /**
   * `--no-input` or CI: nobody is there to act at all, not even in a browser
   * (`login`). `--json` alone still allows a person to approve in a browser.
   */
  readonly unattended: boolean;
}

export interface OutputModeInput {
  readonly json?: boolean;
  /** `--no-input`. */
  readonly noInput?: boolean;
  /** `--yes` / `--no-interactive`: accept defaults instead of asking. */
  readonly yes?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: { readonly isTTY?: boolean };
  readonly stdout?: { readonly isTTY?: boolean };
}

/** `CI=true`, `CI=1` or any other non-empty value except "0" and "false". */
export function isCiEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.CI?.trim().toLowerCase();
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

export function resolveOutputMode(input: OutputModeInput = {}): OutputMode {
  const json = input.json === true;
  const terminal = (input.stdin ?? process.stdin).isTTY === true && (input.stdout ?? process.stdout).isTTY === true;
  const unattended = input.noInput === true || isCiEnvironment(input.env);
  return {
    json,
    interactive: terminal && !json && !unattended && input.yes !== true,
    unattended,
  };
}

let current: OutputMode | undefined;

/** Set by `runCommand` for one invocation; returns a function that restores the previous mode. */
export function setOutputMode(mode: OutputMode): () => void {
  const previous = current;
  current = mode;
  return () => { current = previous; };
}

export function isJsonOutput(): boolean {
  return current?.json ?? false;
}

/**
 * Commands called directly (tests, embedders) keep their interactive
 * behaviour; only the executable decides from the terminal, flags and CI.
 */
export function canPrompt(): boolean {
  return current?.interactive ?? true;
}

export function isUnattended(): boolean {
  return current?.unattended ?? false;
}

/**
 * Fail fast instead of prompting when nobody can answer. `flag` names how to
 * supply the answer (`--style datasets`, `CLICKHOUSE_URL`, …).
 */
export function assertCanPrompt(question: string, flag: string): void {
  if (canPrompt()) return;
  throw new CliError(
    'INPUT_REQUIRED',
    `${question} needs an answer, but this run cannot prompt (no terminal, --json, --no-input, --yes or CI). Pass ${flag}.`,
    { hint: `Pass ${flag} and run the command again.` },
  );
}

/** The single document `--json` writes: pretty-printed, newline-terminated. */
export function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
