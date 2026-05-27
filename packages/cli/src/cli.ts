import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { devCommand, type DevOptions } from './commands/dev.js';
import { generateCommand, type GenerateOptions } from './commands/generate.js';
import { generateMigrationCommand, type GenerateMigrationOptions } from './commands/generate-migration.js';
import { migrationCheckCommand, type MigrationCheckOptions } from './commands/migration-check.js';
import { migrationDeployCommand, type MigrationDeployOptions } from './commands/migration-deploy.js';
import { migrationStatusCommand, type MigrationStatusOptions } from './commands/migration-status.js';
import { pullCommand, type PullOptions } from './commands/pull.js';
import { pushCommand, type PushOptions } from './commands/push.js';

const program = new Command();

export function normalizeInitOptions(options: Record<string, unknown>) {
  return {
    ...options,
    noInteractive: options.noInteractive === true || options.interactive === false,
  };
}

program
  .name('hypequery')
  .description('Type-safe analytics layer for ClickHouse')
  .version('0.0.1');

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
    .option('--tables <names>', 'Only generate for specific tables (comma-separated)')
    .option('--database <type>', 'Database driver to use (default: auto-detect)');
}

// Init command
program
  .command('init')
  .description('Initialize a new hypequery project')
  .option('--path <path>', 'Output directory (default: analytics/)')
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
  .command('generate:migration <name>')
  .description('Generate a ClickHouse schema migration')
  .option('-c, --config <path>', 'Config file (default: hypequery.config.ts)')
  .option('--custom', 'Create a custom SQL migration without advancing the schema snapshot')
  .action(runCommand(async (name: string, options: GenerateMigrationOptions) => {
    await generateMigrationCommand(name, options);
  }));

program
  .command('pull')
  .description('Pull the current ClickHouse schema into a baseline migration snapshot')
  .option('-c, --config <path>', 'Config file (default: hypequery.config.ts)')
  .option('--force', 'Overwrite the configured schema file')
  .option('--tables <names>', 'Only pull specific tables (comma-separated)')
  .option('--exclude-tables <names>', 'Exclude specific tables (comma-separated)')
  .action(runCommand(async (options: PullOptions) => {
    await pullCommand(options);
  }));

program
  .command('push')
  .description('Apply schema changes directly to ClickHouse for development')
  .option('-c, --config <path>', 'Config file (default: hypequery.config.ts)')
  .action(runCommand(async (options: PushOptions) => {
    await pushCommand(options);
  }));

program
  .command('migrate:deploy')
  .description('Apply pending ClickHouse migrations')
  .option('-c, --config <path>', 'Config file (default: hypequery.config.ts)')
  .action(runCommand(async (options: MigrationDeployOptions) => {
    await migrationDeployCommand(options);
  }));

program
  .command('migrate:status')
  .description('Show local ClickHouse migration status')
  .option('-c, --config <path>', 'Config file (default: hypequery.config.ts)')
  .action(runCommand(async (options: MigrationStatusOptions) => {
    await migrationStatusCommand(options);
  }));

program
  .command('migrate:check')
  .description('Verify local ClickHouse migration checksums')
  .option('-c, --config <path>', 'Config file (default: hypequery.config.ts)')
  .action(runCommand(async (options: MigrationCheckOptions) => {
    await migrationCheckCommand(options);
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
  console.log('  hypequery generate:migration add_orders_table');
  console.log('  hypequery pull');
  console.log('  hypequery push');
  console.log('  hypequery migrate:deploy');
  console.log('  hypequery migrate:status');
  console.log('  hypequery migrate:check');
  console.log('');
  console.log('Docs: https://hypequery.com/docs');
});

export { program };
