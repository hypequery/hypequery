#!/usr/bin/env node

import { program } from '../cli.js';
import { envFiles } from '../utils/env-files.js';
import { CommandExit, finishAndExit, installCommandExitFinalizer } from '../utils/command-exit.js';
import { CommandLifecycle } from '../utils/telemetry/lifecycle.js';
import { telemetryErrorCode } from '../utils/telemetry/error-code.js';
import { cleanupLoadedApiArtifacts } from '../utils/load-api.js';
import type { Command } from 'commander';
import { withCommandTelemetry } from '../utils/telemetry/command-context.js';

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

  try {
    const { config } = await import('dotenv');
    for (const path of envFiles(process.env.NODE_ENV)) {
      // Missing files are a no-op.
      config({ path });
    }
  } catch {
    // dotenv is optional; continue if not available
  }
}

async function main() {
  await loadEnv();
  const args = process.argv.slice(2);
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
      await cleanupLoadedApiArtifacts();
    })();
    return finishing;
  };
  installCommandExitFinalizer(finish);
  const crash = (error: Error) => lifecycle.crash(error);
  process.on('uncaughtExceptionMonitor', crash);
  program.exitOverride();
  for (const command of program.commands) command.exitOverride();
  program.hook('preAction', async (_root, command) => {
    selected = command;
    await lifecycle.begin(command.name(), command.opts().database);
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
    await withCommandTelemetry(lifecycle, () => program.parseAsync(process.argv));
    if (lifecycle.command === 'dev') return; // Its shutdown handler finalizes after teardown.
    await finish(new CommandExit(Number(process.exitCode ?? 0), process.exitCode ? 'failure' : 'success', process.exitCode ? 'unknown' : undefined));
  } catch (error) {
    const commander = error as { code?: string; exitCode?: number };
    if (commander.code === 'commander.helpDisplayed' || commander.code === 'commander.help') {
      const topic = selected?.name() === 'help' ? selected.args[0] : selected?.name()
        ?? program.commands.find(command => requested === command.name())?.name();
      await lifecycle.begin('help');
      const code = commander.exitCode ?? 0;
      await lifecycle.finish(new CommandExit(code, code ? 'failure' : 'success', code ? 'validation_failed' : undefined), topic)
        .catch(() => undefined);
      process.exitCode = code;
      await cleanupLoadedApiArtifacts();
      return;
    }
    if (commander.code === 'commander.version') {
      await lifecycle.begin('version');
      await finish(new CommandExit(0, 'success'));
      return;
    }
    if (!selected) await lifecycle.begin(['unknown_command', 'unknown_option'].includes(telemetryErrorCode(error)) ? 'unknown' : requested ?? 'unknown');
    const exit = error instanceof CommandExit ? error
      : new CommandExit(commander.exitCode ?? 1, 'failure', telemetryErrorCode(error));
    await finishAndExit(exit.exitCode, exit.outcome, exit.errorCode);
  }
}

main();
