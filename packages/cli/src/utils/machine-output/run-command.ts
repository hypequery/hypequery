import chalk from 'chalk';
import type { Command } from 'commander';
import { CommandExit } from '../command-exit.js';
import { redirectStdoutToStderr } from '../stdout-to-stderr.js';
import { CLI_EXIT_CODES, CliError, cliErrorEnvelope } from './cli-error.js';
import { toCliError } from './classify-error.js';
import { collectCommandResult } from './command-result.js';
import { jsonDocument, resolveOutputMode, setOutputMode } from './output-mode.js';

export interface RunCommandBehaviour {
  /**
   * The command owns stdout after it starts (`mcp` speaks its protocol there),
   * so `--json` must not redirect it. It still routes its own logs to stderr.
   */
  readonly ownsStdout?: boolean;
  /**
   * The command keeps running after its action resolves (`dev`). With `--json`
   * its later logs stay on stderr after the ready document is written.
   */
  readonly longRunning?: boolean;
}

function isCommand(value: unknown): value is Command {
  return typeof value === 'object' && value !== null
    && typeof (value as Command).opts === 'function'
    && typeof (value as Command).name === 'function';
}

/** Commander passes the command itself as the action's last argument. */
function commandOptions(args: readonly unknown[]): Record<string, unknown> {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const candidate = args[index];
    if (isCommand(candidate)) return candidate.opts();
  }
  return {};
}

/**
 * Wrap a command action with the CLI's machine-output contract:
 *
 * - `--json`: stdout carries exactly one JSON document, the action's result on
 *   success or `{ error: { … } }` on failure; logs, spinners and prose go to
 *   stderr without colour.
 * - Prompts are allowed only with a terminal and without `--json`, `--no-input`,
 *   `--yes`/`--no-interactive` or `CI`; otherwise they fail with INPUT_REQUIRED.
 * - Every failure exits with the code its category maps to (CLI_EXIT_CODES).
 */
export function runCommand<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<unknown>,
  behaviour: RunCommandBehaviour = {},
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    const options = commandOptions(args);
    const mode = resolveOutputMode({
      json: options.json === true,
      noInput: options.input === false,
      yes: options.yes === true || options.interactive === false,
    });
    const restoreMode = setOutputMode(mode);
    const redirect = mode.json && !behaviour.ownsStdout ? redirectStdoutToStderr() : undefined;
    const writeStdout = (text: string) => {
      if (redirect) redirect.writeStdout(text);
      else process.stdout.write(text);
    };
    const colourLevel = chalk.level;
    if (mode.json) chalk.level = 0;
    let keepRedirect = false;
    try {
      const outcome = await collectCommandResult(() => action(...args));
      const result = outcome.set ? outcome.reported : outcome.returned;
      if (mode.json && result !== undefined) writeStdout(jsonDocument(result));
      keepRedirect = behaviour.longRunning === true;
    } catch (error) {
      // Legacy exits (`exitWith`) already reported themselves on stderr.
      if (error instanceof CommandExit && (!mode.json || error.exitCode === 0)) throw error;
      const cliError = error instanceof CommandExit
        ? new CliError(error.exitCode === CLI_EXIT_CODES.INTERRUPTED ? 'CANCELLED' : 'COMMAND_FAILED', 'The command failed; its reason is on stderr.', { telemetry: error.errorCode })
        : toCliError(error);
      if (mode.json) {
        writeStdout(jsonDocument(cliErrorEnvelope(cliError)));
      } else if (cliError.category === 'cancelled') {
        // Ctrl+C at a prompt is a deliberate abort, not a failure.
        console.log('\nCancelled.');
      } else if (!cliError.reported) {
        console.error(cliError.message);
      }
      throw new CommandExit(
        cliError.exitCode,
        cliError.category === 'cancelled' ? 'cancelled' : 'failure',
        cliError.telemetry,
      );
    } finally {
      if (!keepRedirect) redirect?.restore();
      chalk.level = colourLevel;
      restoreMode();
    }
  };
}
