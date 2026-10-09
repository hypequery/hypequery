import { AsyncLocalStorage } from 'node:async_hooks';
import type { COMMAND_PROPERTIES } from './catalog.js';
import type { Properties } from './schema.js';
import type { CommandLifecycle } from './lifecycle.js';
import type { DATABASES } from './domains.js';

export type CommandMetrics<C extends keyof typeof COMMAND_PROPERTIES> = Properties<typeof COMMAND_PROPERTIES[C]> & { database?: typeof DATABASES[number] };
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
