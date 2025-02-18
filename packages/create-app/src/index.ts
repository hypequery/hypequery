#!/usr/bin/env node

import { Command } from 'commander';
import { createApp } from './create-app';
import chalk from 'chalk';

const program = new Command();

program
  .name('create-hypequery-app')
  .description('Create a new HypeQuery dashboard application')
  .argument('<directory>', 'Directory to create the application in')
  .action(async (directory: string) => {
    try {
      await createApp(directory);
    } catch (error) {
      console.error(chalk.red('Error creating application:'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse(); 