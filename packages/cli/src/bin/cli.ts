#!/usr/bin/env node

import { program } from '../cli.js';
import { envFiles } from '../utils/env-files.js';

async function loadEnv() {
  try {
    const dotenvx = await import('@dotenvx/dotenvx');
    if (dotenvx?.config && typeof dotenvx.config.load === 'function') {
      await dotenvx.config.load();
      // Deliberately falls through to the dotenv cascade below. dotenvx has
      // already set whatever it found, and dotenv will not overwrite it, so this
      // only fills in files dotenvx does not read (notably `.env.local`).
    }
  } catch {
    // Optional dependency, ignore if missing
  }

  try {
    const { config } = await import('dotenv');
    for (const path of envFiles(process.env.NODE_ENV)) {
      // Missing files are a no-op.
      config({ path });
    }
  } catch {
    // dotenv is optional; continue if not available
  }
}

async function main() {
  await loadEnv();
  program.parse(process.argv);
}

main();
