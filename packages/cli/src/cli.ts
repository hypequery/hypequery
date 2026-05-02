import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { generateCommand } from './commands/generate.js';
import { generateMigrationCommand } from './commands/generate-migration.js';
import { planCommand } from './commands/plan.js';
import { dropCommand } from './commands/drop.js';
import { statusCommand } from './commands/status.js';
import { pullCommand } from './commands/pull.js';
import { migrateCommand } from './commands/migrate.js';
import { checkCommand } from './commands/check.js';

const program = new Command();

program
  .name('hypequery')
  .description('Type-safe analytics layer for ClickHouse')
  .version('0.0.1');

// Init command
program
  .command('init')
  .description('Initialize a new hypequery project')
  .option('--database <type>', 'Database type (clickhouse|bigquery)')
  .option('--path <path>', 'Output directory (default: analytics/)')
  .option('--no-example', 'Skip example query generation')
  .option('--no-interactive', 'Non-interactive mode (use env vars)')
  .option('--force', 'Overwrite existing files')
  .option('--skip-connection', 'Skip database connectivity test')
  .action(async (options) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

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
  .action(async (file, options) => {
    try {
      await devCommand(file, options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Generate command
program
  .command('generate')
  .description('Regenerate types from ClickHouse')
  .option('-o, --output <path>', 'Output file (default: analytics/schema.ts)')
  .option('--tables <names>', 'Only generate for specific tables (comma-separated)')
  .option('--database <type>', 'Database driver to use (default: auto-detect)')
  .action(async (options) => {
    try {
      await generateCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('generate:migration')
  .description('Generate a ClickHouse schema migration from hypequery.config.ts')
  .requiredOption('--name <slug>', 'Migration name slug')
  .option('--custom', 'Create a custom SQL migration scaffold instead of diffing the schema')
  .option('--config <path>', 'Path to hypequery config file')
  .action(async (options) => {
    try {
      await generateMigrationCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Preview a ClickHouse schema migration without recording it')
  .requiredOption('--name <slug>', 'Migration name slug')
  .option('--config <path>', 'Path to hypequery config file')
  .action(async (options) => {
    try {
      await planCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('drop')
  .description('Remove the latest local migration and roll back journal metadata')
  .option('--config <path>', 'Path to hypequery config file')
  .action(async (options) => {
    try {
      await dropCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show local migration journal status')
  .option('--config <path>', 'Path to hypequery config file')
  .action(async (options) => {
    try {
      await statusCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('pull')
  .description('Baseline a live ClickHouse schema into the managed migration files')
  .option('--config <path>', 'Path to hypequery config file')
  .option('--force', 'Overwrite existing baseline files')
  .action(async (options) => {
    try {
      await pullCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Apply pending local migrations to ClickHouse')
  .option('--config <path>', 'Path to hypequery config file')
  .action(async (options) => {
    try {
      await migrateCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Verify recorded applied migrations against local files')
  .option('--config <path>', 'Path to hypequery config file')
  .action(async (options) => {
    try {
      await checkCommand(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

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
  console.log('  hypequery generate:migration --name add_orders_table');
  console.log('  hypequery plan --name add_orders_table');
  console.log('  hypequery drop');
  console.log('  hypequery status');
  console.log('  hypequery pull --force');
  console.log('  hypequery migrate');
  console.log('  hypequery check');
  console.log('');
  console.log('Docs: https://hypequery.com/docs');
});

export { program };
