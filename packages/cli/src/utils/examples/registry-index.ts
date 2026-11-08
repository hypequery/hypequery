import { readFile } from 'node:fs/promises';

/** One entry of https://hypequery.com/examples.json (see website-next/src/app/examples.json). */
export interface ExamplesIndexEntry {
  slug: string;
  kind: 'example' | 'recipe' | 'guide';
  title: string;
  outcome: string;
  /** Repo-relative folder, e.g. `examples/nextjs-dashboard`. */
  dir: string;
  url: string;
  markdown: string;
  source: string;
  packages: string[];
  keywords: string[];
  language?: 'typescript' | 'python';
  stack?: string[];
  useCases?: string[];
  run?: { install: string; dev: string; test: string };
  env?: Array<{ name: string; description: string; required: boolean }>;
  exampleRequest?: string | null;
  minVersion?: string;
  clickhouseVersion?: string;
}

export interface ExamplesIndex {
  version: 1;
  source: { repository: string; ref: string };
  /** `@hypequery/*` versions the examples were last tested against. */
  packageVersions: Record<string, string>;
  entries: ExamplesIndexEntry[];
}

export const DEFAULT_INDEX_URL = 'https://hypequery.com/examples.json';

export interface LoadIndexOptions {
  /** Overrides `HYPEQUERY_EXAMPLES_INDEX` and the default URL. A URL or a local file path. */
  source?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * Load the registry index from the website, or from a URL / local file named
 * by `HYPEQUERY_EXAMPLES_INDEX` (used by tests and by offline development).
 */
export async function loadExamplesIndex(options: LoadIndexOptions = {}): Promise<ExamplesIndex> {
  const env = options.env ?? process.env;
  const source = options.source ?? env.HYPEQUERY_EXAMPLES_INDEX ?? DEFAULT_INDEX_URL;
  let text: string;
  if (isUrl(source)) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(source, { headers: { accept: 'application/json', 'user-agent': 'hypequery-cli' } });
    if (!response.ok) {
      throw new Error(`Could not load the examples index from ${source} (HTTP ${response.status}). Check your network, or set HYPEQUERY_EXAMPLES_INDEX to a file.`);
    }
    text = await response.text();
  } else {
    text = await readFile(source, 'utf8');
  }
  const parsed = JSON.parse(text) as Partial<ExamplesIndex>;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`The examples index at ${source} has an unexpected shape (version ${String(parsed.version)}). Update @hypequery/cli.`);
  }
  return {
    version: 1,
    source: parsed.source ?? { repository: 'hypequery/hypequery', ref: 'main' },
    packageVersions: parsed.packageVersions ?? {},
    entries: parsed.entries,
  };
}

export function findIndexEntry(index: ExamplesIndex, slug: string): ExamplesIndexEntry | undefined {
  return index.entries.find((entry) => entry.slug === slug);
}
