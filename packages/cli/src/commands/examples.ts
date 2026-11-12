import { emitResult, isJsonOutput } from '../utils/machine-output.js';
import { loadExamplesIndex, type ExamplesIndex, type LoadIndexOptions } from '../utils/examples/registry-index.js';
import { countBucket } from '../utils/telemetry/buckets.js';
import { updateCommandTelemetry } from '../utils/telemetry/command-context.js';
import { EXAMPLE_KINDS } from '../utils/telemetry/domains.js';

export interface ExamplesListOptions {
  json?: boolean;
  /** Filter by kind: example, recipe or guide. */
  kind?: string;
}

export interface ExamplesListDependencies extends LoadIndexOptions {
  write?: (line: string) => void;
}

export function formatExamplesTable(index: ExamplesIndex, kind?: string): string {
  const entries = index.entries.filter((entry) => !kind || entry.kind === kind);
  if (entries.length === 0) return kind ? `No ${kind}s published yet.` : 'The registry is empty.';
  const width = Math.max(...entries.map((entry) => entry.slug.length));
  const lines = entries.map((entry) => `  ${entry.slug.padEnd(width)}  ${entry.kind.padEnd(7)}  ${entry.outcome}`);
  return [
    ...lines,
    '',
    'Scaffold one:  npx @hypequery/cli create <slug> -y',
    `Browse:        ${index.entries[0]?.url.replace(/\/[^/]+\/[^/]+$/, '/examples') ?? 'https://hypequery.com/examples'}`,
  ].join('\n');
}

/** `hypequery examples list [--json] [--kind example|recipe|guide]` */
export async function examplesListCommand(options: ExamplesListOptions = {}, dependencies: ExamplesListDependencies = {}): Promise<void> {
  const write = dependencies.write ?? ((line: string) => console.log(line));
  const index = await loadExamplesIndex(dependencies);
  if (options.kind && !(EXAMPLE_KINDS as readonly string[]).includes(options.kind)) {
    throw new Error(`Unknown --kind ${options.kind}; use example, recipe or guide.`);
  }
  const entries = index.entries.filter((entry) => !options.kind || entry.kind === options.kind);
  updateCommandTelemetry('examples', {
    output: options.json ? 'json' : 'table',
    entry_count_bucket: countBucket(entries.length),
    ...(options.kind ? { kind_filter: options.kind as typeof EXAMPLE_KINDS[number] } : {}),
  });
  if (options.json) {
    const result = { version: index.version, packageVersions: index.packageVersions, entries };
    // Under the global --json, stdout is reserved for the one result document.
    if (isJsonOutput()) emitResult(result);
    else write(JSON.stringify(result, null, 2));
    return;
  }
  write(formatExamplesTable(index, options.kind));
}
