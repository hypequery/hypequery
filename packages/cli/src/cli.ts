import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { devCommand, type DevOptions } from './commands/dev.js';
import { generateCommand, type GenerateOptions } from './commands/generate.js';
import { generateDatasetsCommand, type GenerateDatasetsOptions } from './commands/generate-datasets.js';

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
    .option('--path <path>', 'Analytics directory (derives <path>/schema.ts)')
    .option('--tables <names>', 'Only generate for specific tables (comma-separated)')
    .option('--database <type>', 'Database driver to use (default: auto-detect)');
}

// Init command
program
  .command('init')
  .description('Initialize a new hypequery project')
  .option('--path <path>', 'Output directory (default: analytics/)')
  .option('--style <style>', 'Scaffold style: queries or datasets')
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
  console.log('');
  console.log('Docs: https://hypequery.com/docs');
});

export { program };
