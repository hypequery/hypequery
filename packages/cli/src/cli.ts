import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { devCommand, type DevOptions } from './commands/dev.js';
import { generateCommand, type GenerateOptions } from './commands/generate.js';
import { generateDatasetsCommand, type GenerateDatasetsOptions } from './commands/generate-datasets.js';
import { generateManifestCommand, type GenerateManifestOptions } from './commands/generate-manifest.js';
import {
  buildDeploymentCommand,
  prepareDeploymentReleaseCommand,
  validateDeploymentCommand,
  type BuildDeploymentOptions,
  type PrepareDeploymentReleaseOptions,
} from './commands/deployment.js';
import {
  deployCommand,
  type DeployOptions,
} from './commands/deploy.js';

const program = new Command();

function getCliVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function normalizeInitOptions(options: Record<string, unknown>) {
  return {
    ...options,
    noInteractive: options.noInteractive === true || options.interactive === false,
  };
}

program
  .name('hypequery')
  .description('Type-safe analytics layer for ClickHouse')
  .version(getCliVersion());

function runCommand<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
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
  .option('--no-ui', 'Disable the playground UI')
  .option('--cors', 'Enable CORS')
  .option('--path <path>', 'Analytics directory (loads <path>/api.ts or <path>/queries.ts)')
  .option('-q, --quiet', 'Suppress startup messages')
  .action(runCommand(async (file: string | undefined, options: DevOptions) => {
    await devCommand(file, options);
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
  .option('-o, --output <path>', 'Output file (default: src/datasets/generated.ts)')
  .option('--path <path>', 'Analytics directory (derives <path>/datasets.ts)')
  .option('--tables <names>', 'Only generate for specific tables (comma-separated)')
  .option('--exclude-tables <names>', 'Exclude specific tables (comma-separated)')
  .action(runCommand(async (options: GenerateDatasetsOptions) => {
    await generateDatasetsCommand(options);
  }));

program
  .command('generate:manifest <api>')
  .description('Generate a static React hook manifest from a hypequery API module')
  .option('-o, --output <path>', 'Output JSON file (default: analytics/hypequery-manifest.json)')
  .action(runCommand(async (api: string, options: GenerateManifestOptions) => {
    await generateManifestCommand(api, options);
  }));

program
  .command('deployment:build <api>')
  .description('Build a verified deployment bundle')
  .option('--bundle-output <directory>', 'Bundle directory (default: analytics/hypequery-deployment)')
  .option('-o, --output <path>', 'Output JSON file (default: analytics/hypequery-deployment.json)')
  .option('--runtime <runtime>', 'Runtime for non-portable handlers: node or python (default: node)')
  .option('--runtime-artifact <sha256>', 'Use a prebuilt runtime artifact with this SHA-256 identity')
  .option('--runtime-file <path>', 'Include the bytes for a prebuilt runtime artifact')
  .option('--runtime-output <path>', 'Bundled Node runtime path (default: beside deployment JSON)')
  .option('--entrypoint-prefix <prefix>', 'Runtime entrypoint prefix (default: queries)')
  .option('--hash-output <path>', 'Deployment identity sidecar path (default: <output>.sha256)')
  .action(runCommand(async (api: string, options: BuildDeploymentOptions) => {
    await buildDeploymentCommand(api, options);
  }));

program
  .command('deployment:validate <artifact>')
  .description('Verify a deployment bundle or validate a legacy deployment JSON file')
  .action(runCommand(async (artifact: string) => {
    await validateDeploymentCommand(artifact);
  }));

program
  .command('deployment:release <bundle>')
  .description('Prepare a target-bound release from a verified deployment bundle')
  .requiredOption('--project <project>', 'Target project identifier')
  .requiredOption('--environment <environment>', 'Target environment identifier')
  .option('-o, --output <path>', 'Release JSON path (default: beside the bundle)')
  .action(runCommand(async (bundle: string, options: PrepareDeploymentReleaseOptions) => {
    await prepareDeploymentReleaseCommand(bundle, options);
  }));

program
  .command('deploy <bundle>')
  .description('Submit a verified deployment bundle and release')
  .requiredOption('--release <path>', 'Target-bound release JSON path')
  .option('--endpoint <url>', 'HTTPS submission endpoint (or HYPEQUERY_DEPLOYMENT_ENDPOINT)')
  .action(runCommand(async (bundle: string, options: DeployOptions) => {
    await deployCommand(bundle, options);
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
        process.exit(1);
      }
    } else {
      program.help();
    }
  });

// Custom help
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  hypequery init');
  console.log('  hypequery dev');
  console.log('  hypequery dev --port 3000');
  console.log('  hypequery generate --output analytics/schema.ts');
  console.log('  hypequery generate:types --output analytics/schema.ts');
  console.log('  hypequery generate:datasets');
  console.log('  hypequery generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json');
  console.log('  hypequery deployment:build analytics/api.ts');
  console.log('  hypequery deployment:validate analytics/hypequery-deployment');
  console.log('  hypequery deployment:release analytics/hypequery-deployment --project my-project --environment production');
  console.log('  hypequery deploy analytics/hypequery-deployment --release analytics/hypequery-deployment.release.json');
  console.log('');
  console.log('Docs: https://hypequery.com/docs');
});

export { program };
