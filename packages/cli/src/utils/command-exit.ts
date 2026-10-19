import type { ERROR_CODES, OUTCOMES } from './telemetry/domains.js';

export class CommandExit extends Error {
  constructor(
    readonly exitCode: number,
    readonly outcome: typeof OUTCOMES[number],
    readonly errorCode?: typeof ERROR_CODES[number],
  ) { super('Command requested exit'); }
}

let finalizer: ((exit: CommandExit) => Promise<void>) | undefined;

/** Only the executable installs this; standalone command calls preserve their legacy exits. */
export function installCommandExitFinalizer(finish: (exit: CommandExit) => Promise<void>): () => void {
  finalizer = finish;
  return () => { if (finalizer === finish) finalizer = undefined; };
}

export function exitWith(code: number, outcome: CommandExit['outcome'] = code === 0 ? 'cancelled' : 'failure', errorCode?: CommandExit['errorCode']): never {
  if (finalizer) throw new CommandExit(code, outcome, errorCode);
  return process.exit(code);
}

/** Signal-driven shutdown runs after the owning command's resource cleanup. */
export async function finishAndExit(code: number, outcome: CommandExit['outcome'], errorCode?: CommandExit['errorCode']): Promise<never> {
  try { await finalizer?.(new CommandExit(code, outcome, errorCode)); } catch { /* Preserve exit semantics. */ }
  return process.exit(code);
}
