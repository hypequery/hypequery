#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcCliDir = path.join(rootDir, 'src', 'cli');
const distCliDir = path.join(rootDir, 'dist', 'cli');
const files = ['bin.js', 'generate-types.js', 'index.js', 'type-parsing.js', 'generate-types.d.ts', 'index.d.ts'];

fs.mkdirSync(distCliDir, { recursive: true });

for (const file of files) {
  const source = path.join(srcCliDir, file);
  const dest = path.join(distCliDir, file);

  if (!fs.existsSync(source)) {
    console.error(`Missing CLI source file: ${path.relative(rootDir, source)}`);
    process.exit(1);
  }

  fs.copyFileSync(source, dest);
  console.log(`copied ${file}`);
}

if (process.platform !== 'win32') {
  fs.chmodSync(path.join(distCliDir, 'bin.js'), 0o755);
}
