import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';

export async function createApp(directory: string) {
  const root = path.resolve(directory);
  const appName = path.basename(root);

  const spinner = ora('Creating HypeQuery dashboard...').start();

  try {
    // Create the project directory
    await fs.ensureDir(root);

    // Copy template files
    const templateDir = path.resolve(__dirname, '../template');
    await fs.copy(templateDir, root);

    // Update package.json
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = await fs.readJson(packageJsonPath);
    packageJson.name = appName;
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    spinner.succeed('Created project files');
    spinner.start('Installing dependencies...');

    // Install dependencies
    await execa('npm', ['install'], { cwd: root });

    spinner.succeed('Installed dependencies');
    spinner.start('Initializing git repository...');

    // Initialize git repository
    await execa('git', ['init'], { cwd: root });
    await execa('git', ['add', '.'], { cwd: root });
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: root });

    spinner.succeed('Initialized git repository');

    // Print success message
    console.log();
    console.log(chalk.green('Success!'), 'Created', chalk.cyan(appName), 'at', chalk.cyan(root));
    console.log();
    console.log('Inside that directory, you can run several commands:');
    console.log();
    console.log(chalk.cyan('  npm run dev'));
    console.log('    Starts the development server.');
    console.log();
    console.log(chalk.cyan('  npm run build'));
    console.log('    Builds the app for production.');
    console.log();
    console.log(chalk.cyan('  npm start'));
    console.log('    Runs the built app in production mode.');
    console.log();
    console.log('We suggest that you begin by typing:');
    console.log();
    console.log(chalk.cyan('  cd'), directory);
    console.log(chalk.cyan('  npm run dev'));
    console.log();
  } catch (error) {
    spinner.fail('Failed to create project');
    throw error;
  }
} 