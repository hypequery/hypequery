import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  WriteMigrationArtifactsOptions,
  WriteMigrationArtifactsResult,
} from './types.js';

/**
 * Writes rendered migration artifacts to a migration directory.
 *
 * The migration name must be a single safe path segment. The writer creates
 * `up.sql`, `down.sql`, and `meta.json` files under `outDir/migrationName`.
 */
export async function writeMigrationArtifacts(
  options: WriteMigrationArtifactsOptions,
): Promise<WriteMigrationArtifactsResult> {
  assertValidMigrationName(options.migrationName);

  const migrationDir = path.join(options.outDir, options.migrationName);
  await mkdir(migrationDir, { recursive: true });

  const upPath = path.join(migrationDir, 'up.sql');
  const downPath = path.join(migrationDir, 'down.sql');
  const metaPath = path.join(migrationDir, 'meta.json');

  await writeFile(upPath, `${options.artifacts.upSql}\n`, 'utf8');
  await writeFile(downPath, `${options.artifacts.downSql}\n`, 'utf8');
  await writeFile(metaPath, `${JSON.stringify(options.artifacts.meta, null, 2)}\n`, 'utf8');

  return {
    migrationDir,
    upPath,
    downPath,
    metaPath,
  };
}

function assertValidMigrationName(migrationName: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(migrationName)) {
    throw new Error(
      `Invalid migration name "${migrationName}". ` +
      'Migration names must be a single path segment containing only letters, numbers, underscores, and hyphens.',
    );
  }
}
