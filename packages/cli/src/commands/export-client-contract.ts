import path from 'node:path';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';
import { canonicalClientContract } from '../utils/client-contract-canonical.js';
import { checkClientOutputPath, describeClientContractError, readClientOutput } from '../utils/client-contract-file.js';
import { writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { withStdoutToStderr } from '../utils/stdout-to-stderr.js';
import { CliError } from '../utils/machine-output/cli-error.js';
import { isJsonOutput } from '../utils/machine-output/output-mode.js';

export interface ExportClientContractOptions {
  output?: string;
  stdout?: boolean;
  check?: boolean;
  force?: boolean;
}

/**
 * Write the build view of a TypeScript API's client contract, the artifact
 * `hypequery generate:client` reads, as Python's `export client-contract` does.
 */
export async function exportClientContractCommand(
  apiPath: string | undefined,
  options: ExportClientContractOptions = {},
): Promise<ExportClientContractResult> {
  if (!apiPath) {
    throw new CliError('USAGE', 
      'Missing API module path.\n\n'
      + 'Usage: hypequery export:client-contract analytics/api.ts --output client-contract.json',
    );
  }
  if (options.stdout && (options.output !== undefined || options.check || options.force)) {
    throw new CliError('USAGE', '--stdout cannot be combined with --output, --check or --force.');
  }
  if (options.force && options.check) throw new CliError('USAGE', '--force cannot be combined with --check.');

  // With --stdout, the API module's own startup logs go to stderr so the output stays valid JSON.
  const exported = async () => {
    const api = await loadApiModule(apiPath);
    if (!api || typeof api.clientContract !== 'function') {
      throw new CliError('INVALID_INPUT',
        `Invalid API module: ${apiPath}\n\n`
        + 'The exported API must provide a clientContract() method. Export the value returned by '
        + 'createAPI() from @hypequery/serve, and upgrade @hypequery/serve if it has none.',
      );
    }
    return api.clientContract();
  };
  const contract = options.stdout ? await withStdoutToStderr(exported) : await exported();
  let canonical: string;
  try {
    canonical = canonicalClientContract(contract);
  } catch (error) {
    throw describeClientContractError(error);
  }
  if (canonical.includes('"endpoints":[]')) {
    // Nothing to generate from; Python's export refuses this too.
    throw new CliError('INVALID_INPUT',
      'The client contract has no endpoints. Register datasets or measure-backed metrics with createAPI '
      + '({ datasets, metrics }); named queries are not part of a client contract.',
    );
  }
  if (options.stdout) {
    // With --json the contract is part of the one JSON document instead.
    if (!isJsonOutput()) process.stdout.write(canonical);
    return { status: 'printed', contract: JSON.parse(canonical) as unknown };
  }

  const output = path.resolve(options.output ?? 'client-contract.json');
  const relative = path.relative(process.cwd(), output);
  const shown = relative && !relative.startsWith('..') ? relative : output;
  await checkClientOutputPath(output);
  const current = await readClientOutput(output);
  if (current === canonical) {
    logger.success(`Client contract is up to date: ${shown}`);
    return { status: 'up_to_date', output };
  }
  if (options.check) {
    logger.error('Client contract is missing or out of date; review it with --stdout, then rerun with --force to replace it.');
    throw new CliError('OUT_OF_DATE', `Client contract is ${current === undefined ? 'missing' : 'out of date'}: ${shown}`, {
      reported: true,
      telemetry: current === undefined ? 'output_missing' : 'output_out_of_date',
      hint: 'Review it with --stdout, then rerun with --force to replace it.',
      issues: [{ path: output, message: current === undefined ? 'missing' : 'out of date' }],
    });
  }
  if (current !== undefined && !options.force) {
    throw new CliError('CONFLICT', 'Refusing to overwrite an existing client contract; use --check or --force.');
  }
  await writeGeneratedFileAtomically(output, canonical, { overwrite: options.force === true });
  logger.success(`${current === undefined ? 'Created' : 'Updated'} client contract: ${shown}`);
  return { status: current === undefined ? 'created' : 'updated', output };
}

/** `hypequery export:client-contract --json`. `output` is absolute. */
export type ExportClientContractResult =
  | { readonly status: 'printed'; readonly contract: unknown }
  | { readonly status: 'up_to_date' | 'created' | 'updated'; readonly output: string };
