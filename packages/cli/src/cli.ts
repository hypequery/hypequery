import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { generateCommand } from './commands/generate.js';

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
  console.log('');
  console.log('Docs: https://hypequery.com/docs');
});

export { program };
