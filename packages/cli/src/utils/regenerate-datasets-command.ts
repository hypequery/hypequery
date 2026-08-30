import { CONTEXT_AUTH_TENANT_COLUMN, type AuthTemplateMode } from '../templates/auth-scaffold.js';

export interface RegenerateDatasetsCommandOptions {
  outputDir: string;
  auth: AuthTemplateMode;
  /** Comma-separated table list to suggest, if any. */
  tables?: string;
}

/**
 * The `generate:datasets` invocation to hand a user after `init`.
 *
 * Regeneration rewrites the whole file, so a context-auth scaffold has to
 * repeat its tenant column here. Without it the refresh drops `tenantKey` and
 * every tenant-scoped request starts failing.
 */
export function formatRegenerateDatasetsCommand(
  options: RegenerateDatasetsCommandOptions,
): string {
  const parts = ['hypequery generate:datasets', `--path ${options.outputDir}`];

  if (options.tables) {
    parts.push(`--tables ${options.tables}`);
  }

  if (options.auth === 'context') {
    parts.push(`--tenant-column ${CONTEXT_AUTH_TENANT_COLUMN}`);
  }

  return parts.join(' ');
}
