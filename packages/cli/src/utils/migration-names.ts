export function assertValidMigrationSlug(migrationSlug: string | undefined): asserts migrationSlug is string {
  if (!migrationSlug) {
    throw new Error('Migration name is required. Usage: hypequery generate:migration <name>');
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(migrationSlug)) {
    throw new Error(
      `Invalid migration name "${migrationSlug}". ` +
      'Use only letters, numbers, underscores, and hyphens.',
    );
  }
}

export function createMigrationTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

export function formatMigrationName(timestamp: string, migrationSlug: string): string {
  return `${timestamp}_${migrationSlug}`;
}
