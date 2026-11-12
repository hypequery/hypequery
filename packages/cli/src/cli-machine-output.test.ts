import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/examples/registry-index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./utils/examples/registry-index.js')>(),
  loadExamplesIndex: vi.fn(async () => ({
    version: 1,
    packageVersions: { '@hypequery/cli': '1.0.0' },
    entries: [{ slug: 'p95-latency', kind: 'recipe', outcome: 'p95 latency', url: 'https://hypequery.com/examples/recipes/p95-latency' }],
  })),
}));
vi.mock('./commands/generate.js', () => ({ generateCommand: vi.fn() }));

import { generateCommand } from './commands/generate.js';
import { program } from './cli.js';
import { CommandExit } from './utils/command-exit.js';
import { disableJsonOutput, enableJsonOutput } from './utils/machine-output.js';

describe('--json through the CLI', () => {
  let stdout: string[];

  beforeEach(() => {
    stdout = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enableJsonOutput((text) => stdout.push(text));
  });

  afterEach(() => {
    disableJsonOutput();
    program.setOptionValue('json', undefined);
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('prints the examples registry as the one result on stdout', async () => {
    await program.parseAsync(['examples', 'list', '--json', '--kind', 'recipe'], { from: 'user' });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toMatchObject({
      version: 1,
      packageVersions: { '@hypequery/cli': '1.0.0' },
      entries: [{ slug: 'p95-latency' }],
    });
  });

  it('reports a failure that ends through exitWith, with the fixed exit code', async () => {
    vi.mocked(generateCommand).mockRejectedValueOnce(new CommandExit(1, 'failure', 'connection_failed'));
    await expect(program.parseAsync(['--json', 'generate'], { from: 'user' }))
      .rejects.toMatchObject({ exitCode: 4, errorCode: 'connection_failed' });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]).error).toMatchObject({
      code: 'CONNECTION_FAILED',
      category: 'unavailable',
      retryable: true,
      exitCode: 4,
    });
  });

  it('keeps a deliberate cancellation at exit 0 and still prints one document', async () => {
    vi.mocked(generateCommand).mockRejectedValueOnce(new CommandExit(0, 'cancelled'));
    await expect(program.parseAsync(['--json', 'generate'], { from: 'user' }))
      .rejects.toMatchObject({ exitCode: 0, outcome: 'cancelled' });
    expect(stdout.map((text) => JSON.parse(text))).toEqual([{ ok: true }]);
  });
});
