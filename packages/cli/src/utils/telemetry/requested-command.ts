import { knownCommand } from './flags.js';
import type { TelemetryCommand } from './domains.js';

/**
 * Attributes an invocation Commander rejected before any action ran. A known
 * command with a bad option or argument is still that command; only input that
 * names no registered command is `unknown`.
 */
export function requestedCommand(requested: string | undefined, registered: readonly string[]): TelemetryCommand {
  return requested && registered.includes(requested) ? knownCommand(requested) : 'unknown';
}

/**
 * Commander's "(Did you mean X?)" hint for an unknown command. Only a registered
 * command name is returned; the raw input is never read into telemetry.
 */
export function suggestedCommand(error: unknown, registered: readonly string[]): Exclude<TelemetryCommand, 'unknown'> | undefined {
  try {
    const message = (error as { message?: unknown } | null)?.message;
    const suggestion = typeof message === 'string' ? message.match(/\(Did you mean ([^?\s]+)\?\)/)?.[1] : undefined;
    const command = requestedCommand(suggestion, registered);
    return command === 'unknown' ? undefined : command;
  } catch { return undefined; }
}
