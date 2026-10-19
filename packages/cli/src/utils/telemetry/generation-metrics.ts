import type { DatasetGenerationWarning } from '../../generators/dataset-generator.js';
import { TYPE_FAMILIES, WARNING_CODES } from './domains.js';
import { countBucket } from './buckets.js';
import type { CommandMetrics } from './command-context.js';

export function warningBuckets(warnings: readonly DatasetGenerationWarning[] = []): NonNullable<CommandMetrics<'generate:datasets'>['warning_counts']> {
  return Object.fromEntries(WARNING_CODES.map(code => [code, countBucket(warnings.filter(warning => warning.kind === code).length)]));
}

/** Only inspect already produced manifest data and the loaded registry. */
export function manifestMetrics(api: unknown, manifest: unknown): CommandMetrics<'generate:manifest'> {
  try {
    const queries: unknown = Object.getOwnPropertyDescriptor(api, 'queries')?.value;
    return {
      ...(queries && typeof queries === 'object' ? { query_count_bucket: countBucket(Object.keys(queries).length) } : {}),
      ...(manifest && typeof manifest === 'object' ? { endpoint_count_bucket: countBucket(Object.keys(manifest).length) } : {}),
    };
  } catch { return {}; }
}

/** Reduces fallback type expressions immediately to a closed family domain. */
export class TypeGenerationMetrics {
  private columns = 0;
  private unsupported = 0;
  private families = new Set<typeof TYPE_FAMILIES[number]>();

  column(): void { this.columns++; }

  fallback(type: string): void {
    this.unsupported++;
    const name = /^\s*([A-Za-z][A-Za-z0-9_]*)/.exec(type)?.[1];
    const family = TYPE_FAMILIES.find(value => value === name) ?? 'unknown';
    this.families.add(family);
  }

  snapshot(): CommandMetrics<'generate'> {
    return { column_count_bucket: countBucket(this.columns), unsupported_type_count_bucket: countBucket(this.unsupported),
      unsupported_type_families: TYPE_FAMILIES.filter(family => this.families.has(family)) };
  }
}
