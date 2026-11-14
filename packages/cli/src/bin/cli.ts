#!/usr/bin/env node

import { program } from '../cli.js';
import { CliError } from '../utils/cli-error.js';
import { emitError, enableJsonOutput, errorEnvelope, flushJsonOutput } from '../utils/machine-output.js';
import { loadEnvFiles } from '../utils/load-env-files.js';
import { CommandExit, finishAndExit, installCommandExitFinalizer } from '../utils/command-exit.js';
import { CommandLifecycle } from '../utils/telemetry/lifecycle.js';
import { telemetryErrorCode } from '../utils/telemetry/error-code.js';
import { cleanupLoadedApiArtifacts } from '../utils/load-api.js';
import type { Command } from 'commander';
import { withCommandTelemetry } from '../utils/telemetry/command-context.js';
import { settleTelemetrySettings } from '../utils/telemetry/config-store.js';
import { requestedCommand, suggestedCommand } from '../utils/telemetry/requested-command.js';
import { DEFAULT_COMMAND, isInteractiveTerminal, withDefaultCommand } from '../utils/default-command.js';
import { cloudOperationOf, isCloudOperationGroup } from '../commands/cloud-operations.js';

/** Commander errors must reach the handler below at every depth (`hypequery releases rollback`). */
function overrideExits(command: Command): void {
  command.exitOverride();
  for (const subcommand of command.commands) overrideExits(subcommand);
}

async function loadEnv() {
  try {
    const dotenvx = await import('@dotenvx/dotenvx');
    if (dotenvx?.config && typeof dotenvx.config.load === 'function') {
      await dotenvx.config.load();
      // Deliberately falls through to the dotenv cascade below. dotenvx has
      // already set whatever it found, and dotenv will not overwrite it, so this
      // only fills in files dotenvx does not read (notably `.env.local`).
    }
  } catch {
    // Optional dependency, ignore if missing
  }

  await loadEnvFiles(process.cwd());
}

async function main() {
  await loadEnv();
  const rawArgs = process.argv.slice(2);
  const args = withDefaultCommand(rawArgs, { interactive: isInteractiveTerminal() });
  if (args.length !== rawArgs.length) {
    console.log(`No command given, starting \`hypequery ${DEFAULT_COMMAND}\`. Run \`hypequery --help\` to see all commands.`);
  }
  const requested = args.find(arg => !arg.startsWith('-'));
  const lifecycle = new CommandLifecycle(args, {
    telemetry: args.includes('--no-telemetry') ? false : undefined,
  });
  let selected: Command | undefined;
  let finishing: Promise<void> | undefined;
  const finish = (exit: CommandExit) => {
    finishing ??= (async () => {
      // finish() never rejects; the guard keeps cleanup independent of telemetry.
      await lifecycle.finish(exit, selected?.name() === 'help' ? selected.args[0] : undefined).catch(() => undefined);
      // Signals end in process.exit(), which skips finally blocks: let any
      // settings write release its lock first (bounded).
      await settleTelemetrySettings();
      await cleanupLoadedApiArtifacts();
      // process.exit() follows; let the --json document leave the pipe first.
      // A signal ends the process now: it must not wait on a stalled reader.
      if (exit.outcome !== 'interrupted') await flushJsonOutput();
    })();
    return finishing;
  };
  installCommandExitFinalizer(finish);
  const crash = (error: Error) => lifecycle.crash(error);
  process.on('uncaughtExceptionMonitor', crash);
  overrideExits(program);
  program.hook('preAction', async (_root, command) => {
    selected = command;
    // Every Cloud operation command is recorded as one command; which operation is never sent.
    await lifecycle.begin(cloudOperationOf(command) ? 'cloud-operation' : command.name(), command.opts().database);
  });
  const observeSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    lifecycle.markInterrupted();
    // dev and mcp own asynchronous server teardown once their handlers exist.
    // During startup, or for short commands, the executable owns shutdown.
    if ((lifecycle.command === 'dev' || lifecycle.command === 'mcp') && process.listenerCount(signal) > 1) return;
    void finishAndExit(lifecycle.command === 'dev' || lifecycle.command === 'mcp' ? 0 : signal === 'SIGINT' ? 130 : 143, 'interrupted');
  };
  process.on('SIGINT', () => observeSignal('SIGINT'));
  process.on('SIGTERM', () => observeSignal('SIGTERM'));
  try {
    await withCommandTelemetry(lifecycle, () => program.parseAsync(args, { from: 'user' }));
    if (lifecycle.command === 'dev') return; // Its shutdown handler finalizes after teardown.
    await finish(new CommandExit(Number(process.exitCode ?? 0), process.exitCode ? 'failure' : 'success', process.exitCode ? 'unknown' : undefined));
  } catch (error) {
    const commander = error as { code?: string; exitCode?: number };
    if (commander.code === 'commander.helpDisplayed' || commander.code === 'commander.help') {
      const named = selected?.name() === 'help' ? selected.args[0] : selected?.name()
        ?? program.commands.find(command => requested === command.name())?.name();
      // Help for any Cloud operation group is one topic, like the commands themselves.
      const topic = named && isCloudOperationGroup(named) ? 'cloud-operation' : named;
      await lifecycle.begin('help');
      const code = commander.exitCode ?? 0;
      await lifecycle.finish(new CommandExit(code, code ? 'failure' : 'success', code ? 'validation_failed' : undefined), topic)
        .catch(() => undefined);
      process.exitCode = code;
      await settleTelemetrySettings();
      await cleanupLoadedApiArtifacts();
      return;
    }
    if (commander.code === 'commander.version') {
      await lifecycle.begin('version');
      await finish(new CommandExit(0, 'success'));
      return;
    }
    if (!selected) {
      // Commander rejects bad options and arguments before preAction runs.
      const registered = program.commands.map(command => command.name());
      await lifecycle.begin(requested && isCloudOperationGroup(requested)
        ? 'cloud-operation'
        : requestedCommand(requested, registered));
      const suggestion = suggestedCommand(error, registered);
      if (suggestion) lifecycle.update('unknown', { suggested_command: suggestion });
    }
    const exit = error instanceof CommandExit ? error
      : new CommandExit(commander.exitCode ?? 1, 'failure', telemetryErrorCode(error));
    // Commander rejected the arguments before any command ran, so --json was
    // never enabled; the caller still gets one envelope on stdout.
    if (!(error instanceof CommandExit) && args.includes('--json')) {
      enableJsonOutput();
      emitError(errorEnvelope(
        new CliError('USAGE', error instanceof Error ? error.message.replace(/^error: /, '') : String(error), {
          hint: 'Run the command with --help to see its arguments and options.',
          telemetryCode: telemetryErrorCode(error),
        }),
        'correctable',
        'USAGE',
        exit.exitCode,
      ));
    }
    await finishAndExit(exit.exitCode, exit.outcome, exit.errorCode);
  }
}

main();
