#!/usr/bin/env node

import { program } from '../cli.js';

async function loadEnv() {
  try {
    const dotenvx = await import('@dotenvx/dotenvx');
    if (dotenvx?.config && typeof dotenvx.config.load === 'function') {
      await dotenvx.config.load();
      return;
    }
  } catch {
    // Optional dependency, ignore if missing
  }

  try {
    const { config } = await import('dotenv');
    config();
  } catch {
    // dotenv is optional; continue if not available
  }
}

async function main() {
  await loadEnv();
  program.parse(process.argv);
}

main();
