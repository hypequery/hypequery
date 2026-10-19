import { AsyncLocalStorage } from 'node:async_hooks';
import type { COMMAND_PROPERTIES, SESSION_START_PROPERTIES, SESSION_END_PROPERTIES } from './catalog.js';
import type { Properties } from './schema.js';
import type { CommandLifecycle } from './lifecycle.js';
import type { DATABASES, ERROR_CODES } from './domains.js';

export type CommandMetrics<C extends keyof typeof COMMAND_PROPERTIES> = Properties<typeof COMMAND_PROPERTIES[C]> & { database?: typeof DATABASES[number] };
export type SessionCommand = keyof typeof SESSION_START_PROPERTIES;
export type SessionStart<C extends SessionCommand> = Properties<typeof SESSION_START_PROPERTIES[C]>;
export type SessionEnd<C extends SessionCommand> = Properties<typeof SESSION_END_PROPERTIES[C]>;
const context = new AsyncLocalStorage<CommandLifecycle>();

/** Command callbacks and their asynchronous work share only this invocation. */
export function withCommandTelemetry<T>(lifecycle: CommandLifecycle, action: () => T): T {
  return context.run(lifecycle, action);
}

export function updateCommandTelemetry<C extends keyof typeof COMMAND_PROPERTIES>(command: C, metrics: CommandMetrics<C>): void {
  try { context.getStore()?.update(command, metrics); } catch { /* Metrics never affect commands. */ }
}

export function cancelCommandTelemetry(): void {
  try { context.getStore()?.cancel(); } catch { /* Preserve cancellation behavior. */ }
}

export function startCommandSession<C extends SessionCommand>(command: C, start: SessionStart<C>, end: () => SessionEnd<C>): void {
  try { context.getStore()?.startSession(command, start, end); } catch { /* Sessions never affect commands. */ }
}

export function setCommandTelemetryError(code: typeof ERROR_CODES[number]): void {
  try { context.getStore()?.setError(code); } catch { /* Preserve command errors. */ }
}
