import { AsyncLocalStorage } from 'node:async_hooks';

interface ResultSlot {
  value?: unknown;
  set: boolean;
}

const context = new AsyncLocalStorage<ResultSlot>();

/**
 * Run `action` and capture the document it reports with `setCommandResult`.
 * The executable prints it with `--json`; standalone calls ignore it.
 */
export async function collectCommandResult<T>(action: () => Promise<T>): Promise<{ returned: T; reported?: unknown; set: boolean }> {
  const slot: ResultSlot = { set: false };
  const returned = await context.run(slot, action);
  return { returned, set: slot.set, ...(slot.set ? { reported: slot.value } : {}) };
}

/**
 * Add fields to this command's `--json` document (a shallow merge). A command
 * composed of others (`deploy` runs build, release and submit) reports the
 * union of their fields. Each command documents its shape in the CLI
 * reference; fields are only ever added.
 */
export function mergeCommandResult(fields: Readonly<Record<string, unknown>>): void {
  const slot = context.getStore();
  if (!slot) return;
  slot.value = { ...(slot.value as Record<string, unknown> | undefined), ...fields };
  slot.set = true;
}
