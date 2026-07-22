#!/usr/bin/env node
// Conformance runner CLI.
//
//   hypequery-protocol-conformance run [options] -- <adapter command...>
//   hypequery-protocol-conformance list [--fixtures <dir>]
//
// Everything after `--` is the adapter argv, spawned without a shell.
import { createJsonLoader, loadManifest, resolveFixturesDir } from '../fs.js';
import { enumerateAllCases } from '../manifest.js';
import { formatJsonReport, formatPrettyReport } from '../report.js';
import { runConformance } from '../runner.js';

interface ParsedArgs {
  readonly command: string | undefined;
  readonly options: Record<string, string | boolean>;
  readonly adapterCommand: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const separator = argv.indexOf('--');
  const head = separator === -1 ? argv : argv.slice(0, separator);
  const adapterCommand = separator === -1 ? [] : argv.slice(separator + 1);

  const command = head[0] && !head[0].startsWith('--') ? head[0] : undefined;
  const options: Record<string, string | boolean> = {};
  for (let i = command ? 1 : 0; i < head.length; i += 1) {
    const token = head[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = head[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, options, adapterCommand };
}

async function main(): Promise<number> {
  const { command, options, adapterCommand } = parseArgs(process.argv.slice(2));
  const fixturesDir = typeof options.fixtures === 'string' ? options.fixtures : undefined;

  if (command === 'list') {
    const dir = resolveFixturesDir(fixturesDir);
    const manifest = loadManifest(dir);
    const cases = enumerateAllCases(manifest, createJsonLoader(dir));
    const counts = new Map<string, number>();
    for (const c of cases) counts.set(c.family, (counts.get(c.family) ?? 0) + 1);
    for (const [family, count] of counts) process.stdout.write(`${family}\t${count}\n`);
    process.stdout.write(`total\t${cases.length}\n`);
    return 0;
  }

  if (command !== 'run') {
    process.stderr.write('usage: hypequery-protocol-conformance run [options] -- <adapter command...>\n');
    return 2;
  }

  if (adapterCommand.length === 0) {
    process.stderr.write('error: no adapter command given after `--`\n');
    return 2;
  }

  const families = typeof options.families === 'string'
    ? options.families.split(',').map((f) => f.trim()).filter(Boolean)
    : undefined;

  let summary;
  try {
    summary = await runConformance({
      adapterCommand,
      fixturesDir,
      families,
      timeoutMs: typeof options['timeout-ms'] === 'string' ? Number(options['timeout-ms']) : undefined,
      skipFuzz: options['skip-fuzz'] === true,
      onlyFuzz: options['only-fuzz'] === true,
    });
  } catch (error) {
    process.stderr.write(`conformance run failed: ${String(error)}\n`);
    return 2;
  }

  const report = options.report === 'json' ? formatJsonReport(summary) : formatPrettyReport(summary);
  process.stdout.write(`${report}\n`);
  return summary.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(2);
  });
