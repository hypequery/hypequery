import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { withFileLock } from '../file-lock.js';
import { readGeneratedFile, writeGeneratedFileAtomically } from '../generated-file.js';

/** Why a config file was left alone. */
export class AgentConfigError extends Error {
  constructor(message: string, readonly file: string) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed file, or `{}` when it does not exist. Comments and invalid JSON are refused, never rewritten. */
export async function readJsonConfig(file: string): Promise<{ source: string | undefined; config: Record<string, unknown> }> {
  const source = await readGeneratedFile(file);
  if (source === undefined || source.trim() === '') return { source, config: {} };
  let config: unknown;
  try {
    config = JSON.parse(source);
  } catch (error) {
    throw new AgentConfigError(
      `${file} is not plain JSON (${(error as Error).message}), so it was left unchanged. Fix it or add the server by hand.`,
      file,
    );
  }
  if (!isRecord(config)) throw new AgentConfigError(`${file} must hold a JSON object; it was left unchanged.`, file);
  return { source, config };
}

/** The object at `pointer`, or undefined; an existing non-object there is an error. */
export function serversAt(config: Record<string, unknown>, pointer: readonly string[], file: string): Record<string, unknown> | undefined {
  let current: unknown = config;
  for (const key of pointer) {
    if (!isRecord(current)) return undefined;
    current = current[key];
    if (current === undefined) return undefined;
  }
  if (!isRecord(current)) throw new AgentConfigError(`${file}: ${pointer.join('.')} must be an object; it was left unchanged.`, file);
  return current;
}

export type JsonEditOutcome = 'added' | 'updated' | 'unchanged' | 'removed' | 'absent';

export interface JsonEdit {
  readonly file: string;
  readonly pointer: readonly string[];
  readonly name: string;
  /** The entry to write, or undefined to remove it. */
  readonly value: Record<string, unknown> | undefined;
  /** May the existing entry be replaced or removed? */
  readonly replaceable: (current: unknown) => boolean;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

/**
 * Set or remove `mcpServers.<name>` in a JSON config, keeping everything else.
 * The previous file is copied to `<file>.hypequery-backup` and the new one is
 * written atomically with the old file's permissions. An entry the CLI did
 * not write is replaced only with `force`.
 */
export async function editJsonServer(edit: JsonEdit): Promise<JsonEditOutcome> {
  // Read, change and write under one lock, so two installs (say for two
  // projects in one ~/.claude.json) can't each write back a copy without the
  // other's entry.
  if (edit.dryRun) return applyEdit(edit);
  await mkdir(path.dirname(edit.file), { recursive: true });
  return withFileLock(edit.file, () => applyEdit(edit));
}

async function applyEdit(edit: JsonEdit): Promise<JsonEditOutcome> {
  const { source, config } = await readJsonConfig(edit.file);
  const servers = serversAt(config, edit.pointer, edit.file);
  const current = servers?.[edit.name];
  if (edit.value === undefined && current === undefined) return 'absent';
  if (edit.value !== undefined && isDeepStrictEqual(current, edit.value)) return 'unchanged';
  if (current !== undefined && !edit.force && !edit.replaceable(current)) {
    throw new AgentConfigError(
      `${edit.file} already has an MCP server named "${edit.name}" that hypequery did not write. `
        + 'Pass --force to replace it, or remove it first.',
      edit.file,
    );
  }
  const outcome: JsonEditOutcome = edit.value === undefined ? 'removed' : current === undefined ? 'added' : 'updated';
  if (edit.dryRun) return outcome;

  let parent: Record<string, unknown> = config;
  for (const key of edit.pointer) {
    const next = parent[key];
    if (!isRecord(next)) parent[key] = {};
    parent = parent[key] as Record<string, unknown>;
  }
  if (edit.value === undefined) delete parent[edit.name];
  else parent[edit.name] = edit.value;

  await mkdir(path.dirname(edit.file), { recursive: true });
  if (source !== undefined) {
    // The backup is as private as the file it copies.
    const backup = `${edit.file}.hypequery-backup`;
    await copyFile(edit.file, backup);
    await chmod(backup, (await stat(edit.file)).mode & 0o777);
  }
  await writeGeneratedFileAtomically(edit.file, `${JSON.stringify(config, null, 2)}\n`, { overwrite: source !== undefined });
  return outcome;
}
