import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { mcpCommand, type McpOptions } from './commands/mcp.js';
import { skillCommand, type SkillOptions } from './commands/skill.js';
import { examplesListCommand, type ExamplesListOptions } from './commands/examples.js';
import { createCommand, type CreateOptions } from './commands/create.js';
import { devCommand, type DevOptions } from './commands/dev.js';
import { generateCommand, type GenerateOptions } from './commands/generate.js';
import { generateDatasetsCommand, type GenerateDatasetsOptions } from './commands/generate-datasets.js';
import { generateClientCommand, type GenerateClientOptions } from './commands/generate-client.js';
import { generateManifestCommand, type GenerateManifestOptions } from './commands/generate-manifest.js';
import { exportClientContractCommand, type ExportClientContractOptions } from './commands/export-client-contract.js';
import {
  buildDeploymentCommand,
  prepareDeploymentReleaseCommand,
  validateDeploymentCommand,
  type BuildDeploymentOptions,
  type PrepareDeploymentReleaseOptions,
} from './commands/deployment.js';
import {
  deployCommand,
  submitDeploymentCommand,
  type DeployOptions,
  type SubmitDeploymentOptions,
} from './commands/deploy.js';
import {
  deploymentStatusCommand,
  type DeploymentStatusOptions,
} from './commands/deployment-status.js';
import {
  loginCommand,
  logoutCommand,
  type LoginOptions,
} from './commands/login.js';
import {
  diffCommand,
  pullCommand,
  type LiveSourceOptions,
  type PullOptions,
} from './commands/live-source.js';
import { isPromptCancelled } from './utils/prompts.js';
import { telemetryCommand } from './commands/telemetry.js';
import { getCliVersion } from './utils/cli-version.js';
import { CommandExit } from './utils/command-exit.js';
import { isCliError } from './utils/cli-error.js';
import { EXIT_CODES, exitClassFor } from './utils/exit-codes.js';
import {
  emitDefaultResult,
  emitError,
  enableJsonOutput,
  errorEnvelope,
  isJsonOutput,
} from './utils/machine-output.js';
import { telemetryErrorCode } from './utils/telemetry/error-code.js';

const program = new Command();

export function normalizeInitOptions(options: Record<string, unknown>) {
  return {
    ...options,
    noInteractive: options.noInteractive === true || options.interactive === false,
  };
}

program
  .name('hypequery')
  .description('Type-safe embedded analytics on ClickHouse')
  .version(getCliVersion())
  .option('--no-telemetry', 'Disable anonymous usage telemetry for this invocation')
  .option('--json', 'Print one JSON result (or error) on stdout; logs go to stderr; never prompt');

// `--json` is read before any command runs, so its output starts clean.
program.hook('preAction', () => {
  if (program.opts().json) enableJsonOutput();
});

program
  .command('telemetry [action]')
  .description('Show or change anonymous usage telemetry settings (status|enable|disable)')
  .action(runCommand(async (action: string | undefined) => {
    await telemetryCommand(action, { telemetry: program.opts().telemetry });
  }));

program
  .command('examples [action]')
  .description('List the runnable examples, recipes and guides in the registry (action: list)')
  .option('--kind <kind>', 'Only example, recipe or guide')
  .action(runCommand(async (action: string | undefined, options: ExamplesListOptions) => {
    if (action !== undefined && action !== 'list') {
      throw new Error(`Unknown action "${action}". Usage: hypequery examples list [--json] [--kind example|recipe|guide]`);
    }
    await examplesListCommand({ ...options, json: isJsonOutput() });
  }));

program
  .command('create <slug>')
  .description('Scaffold an example or recipe from the registry into ./<slug>, pinned to published versions')
  .option('-y, --yes', 'Accept defaults and never prompt')
  .option('--dir <path>', 'Target directory (default: ./<slug>)')
  .option('--no-install', 'Skip installing dependencies')
  .option('--no-seed', 'Skip copying the shared seed dataset into ./<slug>/seed')
  .option('--tag <dist-tag>', 'Dist-tag for @hypequery/* packages whose recorded version is not on npm (default: latest)')
  .action(runCommand(async (slug: string, options: CreateOptions) => {
    await createCommand(slug, options);
  }));

program
  .command('login')
  .description('Authorize this machine with Hypequery Cloud')
  .option('--cloud-url <url>', 'Cloud origin (or HYPEQUERY_CLOUD_URL)')
  .option('--environment <environment>', 'Stable deployment target')
  .action(runCommand(async (options: LoginOptions) => {
    await loginCommand(options);
  }));

program
  .command('logout')
  .description('Revoke and remove the local Hypequery Cloud credential')
  .action(runCommand(async () => {
    await logoutCommand();
  }));

program
  .command('pull')
  .description('Download the source snapshot from the live deployment')
  .option('-o, --output <directory>', 'New destination directory')
  .option('--project <project>', 'Target project identifier (advanced override)')
  .option('--environment <environment>', 'Target environment identifier (advanced override)')
  .option('--endpoint <url>', 'HTTPS submission endpoint; requires HYPEQUERY_API_TOKEN')
  .action(runCommand(async (options: PullOptions) => {
    await pullCommand(options);
  }));

program
  .command('diff [source]')
  .description('Compare local source with the live deployment')
  .option('--project <project>', 'Target project identifier (advanced override)')
  .option('--environment <environment>', 'Target environment identifier (advanced override)')
  .option('--endpoint <url>', 'HTTPS submission endpoint; requires HYPEQUERY_API_TOKEN')
  .action(runCommand(async (source: string | undefined, options: LiveSourceOptions) => {
    await diffCommand(source, options);
  }));

function runCommand<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      if (error instanceof CommandExit) throw error;
      // Ctrl+C at a prompt is a deliberate abort, not a failure: report it as
      // the interrupt it is instead of dumping an error and exiting 1.
      if (isPromptCancelled(error)) {
        console.log('\nCancelled.');
        throw new CommandExit(EXIT_CODES.interrupted, 'cancelled', 'prompt_cancelled');
      }
      const telemetryCode = isCliError(error) ? error.telemetryCode : telemetryErrorCode(error);
      const exitClass = isCliError(error) ? error.exitClass : exitClassFor(telemetryCode, error);
      if (isJsonOutput()) emitError(errorEnvelope(error, exitClass, telemetryCode.toUpperCase()));
      console.error(error instanceof Error ? error.message : error);
      throw new CommandExit(EXIT_CODES[exitClass], 'failure', telemetryCode);
    }
    if (!isJsonOutput()) return;
    // Commands that report failure through process.exitCode print their reasons
    // to stderr; stdout still gets one JSON document.
    if (process.exitCode) {
      emitError(errorEnvelope(
        new Error('The command failed; its reasons are on stderr.'),
        'correctable',
        'COMMAND_FAILED',
      ));
      return;
    }
    emitDefaultResult();
  };
}

function addTypeGenerationOptions(command: Command) {
  return command
    .description('Regenerate types from ClickHouse')
    .option('-o, --output <path>', 'Output file (default: analytics/schema.ts)')
    .option('--path <path>', 'Analytics directory (derives <path>/schema.ts)')
    .option('--tables <names>', 'Only generate for specific tables (comma-separated)')
    .option('--database <type>', 'Database driver to use: clickhouse or chdb (default: auto-detect)')
    .option('--chdb-path <path>', 'Embedded chDB data directory (with --database chdb; omit for in-memory)');
}

// Init command
program
  .command('init')
  .description('Initialize a new hypequery project')
  .option('--path <path>', 'Output directory (default: analytics/)')
  .option('--style <style>', 'Scaffold style: queries or datasets')
  .option('--database <type>', 'Database driver: clickhouse (default) or chdb for embedded, zero-server ClickHouse')
  .option('--chdb-path <path>', 'Embedded chDB data directory (with --database chdb; omit for in-memory)')
  .option('--auth <mode>', 'Auth scaffold mode: none or context')
  .option('--all-tables', 'Generate datasets for all discovered tables when using --style datasets')
  .option('--tables <names>', 'Generate datasets for specific tables when using --style datasets (comma-separated)')
  .option('--exclude-tables <names>', 'Exclude tables from dataset generation when using --style datasets (comma-separated)')
  .option('--no-example', 'Skip example query generation')
  .option('--no-interactive', 'Non-interactive mode (use env vars)')
  .option('--force', 'Overwrite existing files')
  .option('--skip-connection', 'Skip database connectivity test')
  .action(runCommand(async (options: Record<string, unknown>) => {
    await initCommand(normalizeInitOptions(options));
  }));

// Dev command
program
  .command('dev [file]')
  .description('Start development server')
  .option('-p, --port <port>', 'Port number', (val) => parseInt(val, 10))
  .option('-h, --hostname <host>', 'Host to bind (default: localhost)')
  .option('--no-watch', 'Disable file watching')
  .option('--no-cache', 'Disable caching')
  .option('--cache <provider>', 'Cache provider (memory|redis)')
  .option('--redis-url <url>', 'Redis connection URL')
  .option('--open', 'Open browser automatically')
  .option('--cors', 'Enable CORS')
  .option('--path <path>', 'Analytics directory (loads <path>/api.ts or <path>/queries.ts)')
  .option('-q, --quiet', 'Suppress startup messages')
  .action(runCommand(async (file: string | undefined, options: DevOptions) => {
    await devCommand(file, options);
  }));

program
  .command('mcp [file]')
  .description('Serve local datasets or authorized HTTP client endpoints over MCP stdio')
  .option('--path <path>', 'Analytics directory (loads <path>/api.ts or <path>/queries.ts)')
  .option('--tenant <id>', 'Trusted tenant applied to every tenant-scoped dataset')
  .option('--self-test', 'Check the entrypoint and exit without speaking MCP')
  .option('--url <url>', 'With --self-test: check a hosted MCP endpoint (key from HYPEQUERY_API_KEY)')
  .option('--client-contract-url <url>', 'Bridge authorized HTTP client endpoints to MCP (Bearer key from HYPEQUERY_API_KEY)')
  .action(runCommand(async (file: string | undefined, options: McpOptions) => {
    await mcpCommand(file, options);
  }));

program
  .command('skill [action]')
  .description('Install hypequery agent skills for Claude Code, Cursor and Codex (install)')
  .option('--agent <agent>', 'claude, cursor, codex or all (default: all)')
  .option('--scope <scope>', 'project (default) or user')
  .option('--force', 'Replace skills that were edited or are out of date')
  .option('--check', 'Exit 1 if a skill is missing or out of date, without writing')
  .action(runCommand(async (action: string | undefined, options: SkillOptions) => {
    await skillCommand(action, options);
  }));

// Generate command
addTypeGenerationOptions(program.command('generate'))
  .action(runCommand(async (options: GenerateOptions) => {
    await generateCommand(options);
  }));

addTypeGenerationOptions(program.command('generate:types'))
  .action(runCommand(async (options: GenerateOptions) => {
    await generateCommand({ ...options, commandName: 'hypequery generate:types' });
  }));

program
  .command('generate:datasets')
  .description('Generate dataset definitions from ClickHouse schema')
  .option('-o, --output <path>', 'Output file (default: analytics/datasets.ts)')
  .option('--path <path>', 'Analytics directory (derives <path>/datasets.ts)')
  .option('--tables <names>', 'Only generate for specific tables (comma-separated)')
  .option('--exclude-tables <names>', 'Exclude specific tables (comma-separated)')
  .option(
    '--tenant-column <column>',
    'Set tenantKey to this column on tables that have it (requires a trusted runtime tenant scope)',
  )
  .option('--force', 'Replace an existing output file when generated contents differ')
  .option('--check', 'Exit with an error when the output file is missing or out of date')
  .option('--diff', 'Print generated changes without writing them')
  .action(runCommand(async (options: GenerateDatasetsOptions) => {
    await generateDatasetsCommand(options);
  }));

program
  .command('generate:client [contract]')
  .description('Generate browser-safe TypeScript API types and routes from a client contract JSON file or the live Cloud release')
  .option('-o, --output <path>', 'Output TypeScript file (default: analytics/hypequery-client.ts)')
  .option('--check', 'Check for drift without writing')
  .option('--force', 'Replace an existing output file')
  .option('--cloud', 'Use the live Cloud release of the target from `hypequery login`')
  .option('--project <project>', 'With --cloud: target project identifier (advanced override)')
  .option('--environment <environment>', 'With --cloud: target environment identifier (advanced override)')
  .option('--endpoint <url>', 'With --cloud: HTTPS submission endpoint; requires HYPEQUERY_API_TOKEN')
  .action(runCommand(async (contract: string | undefined, options: GenerateClientOptions) => {
    await generateClientCommand(contract, options);
  }));

program
  .command('generate:manifest <api>')
  .description('Generate a static React hook manifest from a hypequery API module')
  .option('-o, --output <path>', 'Output JSON file (default: analytics/hypequery-manifest.json)')
  .action(runCommand(async (api: string, options: GenerateManifestOptions) => {
    await generateManifestCommand(api, options);
  }));

program
  .command('export:client-contract <api>')
  .description('Export the client contract of a TypeScript serve API for hypequery generate:client')
  .option('-o, --output <path>', 'Output JSON file (default: client-contract.json)')
  .option('--stdout', 'Write the canonical contract to stdout only')
  .option('--check', 'Check for drift without writing')
  .option('--force', 'Replace an existing contract file')
  .action(runCommand(async (api: string, options: ExportClientContractOptions) => {
    await exportClientContractCommand(api, options);
  }));

program
  .command('deployment:build <cloud>')
  .description('Build a verified dataset-only Cloud deployment bundle')
  .option('--bundle-output <directory>', 'Bundle directory (default: analytics/hypequery-deployment)')
  .option('--no-source', 'Exclude project source files from the deployment bundle')
  .action(runCommand(async (cloud: string, options: BuildDeploymentOptions) => {
    await buildDeploymentCommand(cloud, options);
  }));

program
  .command('deployment:validate <artifact>')
  .description('Verify a deployment bundle or validate a deployment contract JSON file')
  .action(runCommand(async (artifact: string) => {
    await validateDeploymentCommand(artifact);
  }));

program
  .command('deployment:release <bundle>')
  .description('Prepare a target-bound release from a verified deployment bundle')
  .option('--project <project>', 'Target project identifier (advanced override)')
  .option('--environment <environment>', 'Target environment identifier (advanced override)')
  .option('-o, --output <path>', 'Release JSON path (default: beside the bundle)')
  .action(runCommand(async (bundle: string, options: PrepareDeploymentReleaseOptions) => {
    await prepareDeploymentReleaseCommand(bundle, options);
  }));

program
  .command('deployment:submit <bundle>')
  .description('Submit a prebuilt deployment bundle and release')
  .requiredOption('--release <path>', 'Target-bound release JSON path')
  .option('--draft <name>', 'Save a named Cloud draft without publishing Production')
  .option(
    '--endpoint <url>',
    'HTTPS submission endpoint; requires HYPEQUERY_API_TOKEN',
  )
  .option(
    '--replace-restored',
    'Intentionally replace a restored live release',
  )
  .action(runCommand(async (bundle: string, options: SubmitDeploymentOptions) => {
    await submitDeploymentCommand(bundle, options);
  }));

program
  .command('deployment:status')
  .description('Show the live release and hosted connection details for a Cloud target')
  .option('--project <project>', 'Target project identifier (advanced override)')
  .option('--environment <environment>', 'Target environment identifier (advanced override)')
  .option('--endpoint <url>', 'HTTPS submission endpoint; requires HYPEQUERY_API_TOKEN')
  .option('--mcp-config', 'Also print MCP client configuration for the hosted endpoint')
  .action(runCommand(async (options: DeploymentStatusOptions) => {
    await deploymentStatusCommand(options);
  }));

program
  .command('deploy <source>')
  .description('Build, prepare, and deploy a dataset-only Cloud publication')
  .option('--bundle-output <directory>', 'Bundle directory (default: analytics/hypequery-deployment)')
  .option('--release-output <path>', 'Release JSON path (default: beside the bundle)')
  .option('--project <project>', 'Target project identifier (advanced override)')
  .option('--environment <environment>', 'Target environment identifier (advanced override)')
  .option('--no-source', 'Exclude project source files from the deployment bundle')
  .option('--draft <name>', 'Save a named Cloud draft without publishing Production')
  .option(
    '--endpoint <url>',
    'HTTPS submission endpoint; requires HYPEQUERY_API_TOKEN',
  )
  .option(
    '--replace-restored',
    'Intentionally replace a restored live release',
  )
  .option('--mcp-config', 'Also print MCP client configuration for the hosted endpoint')
  .option('--client <path>', 'Regenerate this typed client file from the new live release')
  .action(runCommand(async (source: string, options: DeployOptions) => {
    await deployCommand(source, options);
  }));

// Help command
program
  .command('help [command]')
  .description('Show help for command')
  .action((command) => {
    if (command) {
      const cmd = program.commands.find((c) => c.name() === command);
      if (cmd) {
        cmd.help();
      } else {
        console.error(`Unknown command: ${command}`);
        throw new CommandExit(1, 'failure', 'unknown_command');
      }
    } else {
      program.help();
    }
  });

// Custom help
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  hypequery telemetry status');
  console.log('  hypequery telemetry disable');
  console.log('  hypequery --no-telemetry init');
  console.log('  hypequery login');
  console.log('  hypequery logout');
  console.log('  hypequery init');
  console.log('  hypequery dev');
  console.log('  hypequery dev --port 3000');
  console.log('  hypequery generate --output analytics/schema.ts');
  console.log('  hypequery generate:types --output analytics/schema.ts');
  console.log('  hypequery generate:datasets');
  console.log('  hypequery examples list');
  console.log('  hypequery create nextjs-dashboard -y');
  console.log('  hypequery generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json');
  console.log('  hypequery export:client-contract analytics/api.ts --output client-contract.json');
  console.log('  hypequery deploy analytics/cloud.ts');
  console.log('  hypequery deploy analytics/cloud.ts --project my-project --environment production');
  console.log('  hypequery deployment:build analytics/cloud.ts');
  console.log('  hypequery deployment:validate analytics/hypequery-deployment');
  console.log('  hypequery deployment:release analytics/hypequery-deployment --project my-project --environment production');
  console.log('  hypequery deployment:submit analytics/hypequery-deployment --release analytics/hypequery-deployment.release.json');
  console.log('');
  console.log('Machine output (--json): one JSON result or {"error": {...}} on stdout, logs on stderr.');
  console.log('Exit codes: 0 ok, 1 correctable, 2 auth, 3 plan, 4 transient, 5 internal, 130 interrupted.');
  console.log('');
  console.log('Docs: https://hypequery.com/docs');
});

export { program };
