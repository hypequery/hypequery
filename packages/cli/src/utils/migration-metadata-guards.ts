import type { Snapshot } from '@hypequery/schema';
import type { MigrationJournalEntry } from './migration-state.js';
import { isRecord } from './runtime-guards.js';

export function isSnapshot(value: unknown): value is Snapshot {
  return isRecord(value) &&
    value.version === 1 &&
    value.dialect === 'clickhouse' &&
    Array.isArray(value.tables) &&
    Array.isArray(value.materializedViews) &&
    Array.isArray(value.dependencies) &&
    typeof value.contentHash === 'string';
}

export function isMigrationJournalEntry(value: unknown): value is MigrationJournalEntry {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.custom === 'boolean' &&
    typeof value.sourceSnapshotHash === 'string' &&
    typeof value.targetSnapshotHash === 'string' &&
    (value.checksum === undefined || typeof value.checksum === 'string');
}
