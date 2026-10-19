import path from 'node:path';
import type { DevOptions } from '../../commands/dev.js';
import type { SessionStart } from './command-context.js';

/** Explicit file arguments are classified without examining or retaining their path. */
export function entryType(resolved: string, explicit?: string): SessionStart<'dev'>['entry_type'] {
  if (explicit) return 'explicit_file';
  const basename = path.basename(resolved);
  return basename === 'hypequery.ts' || basename === 'api.ts' || basename === 'queries.ts' ? basename : 'unknown';
}

export function devSessionConfig(resolved: string, explicit: string | undefined, options: DevOptions): SessionStart<'dev'> {
  const cache: unknown = options.cache;
  return {
    entry_type: entryType(resolved, explicit), watch: options.watch !== false,
    cache_provider: cache === false || cache === 'none' ? 'none' : cache === 'memory' || cache === 'redis' ? cache : 'unknown',
    cors: options.cors === true, open: options.open === true,
    custom_port: options.port !== undefined && options.port !== 4000, quiet: options.quiet === true,
  };
}
