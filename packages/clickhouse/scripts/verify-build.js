#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const requiredFiles = [
  'index.js',
  'index.d.ts',
  'index.node.js',
  'index.node.d.ts',
  'core/connection.js',
  'core/query-builder.js',
  'cli/bin.js',
  'cli/generate-types.js',
  'cli/index.js',
];
const requiredDirs = ['core', 'cli', 'types'];
const requiredIndexMarkers = ['createQueryBuilder', 'ClickHouseConnection', 'selectExpr'];
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(fs.existsSync(distDir), 'Missing dist directory');

for (const file of requiredFiles) {
  check(fs.existsSync(path.join(distDir, file)), `Missing ${file}`);
}

for (const dir of requiredDirs) {
  const target = path.join(distDir, dir);
  check(fs.existsSync(target) && fs.statSync(target).isDirectory(), `Missing ${dir}/`);
}

const indexPath = path.join(distDir, 'index.js');
if (fs.existsSync(indexPath)) {
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  for (const marker of requiredIndexMarkers) {
    check(indexContent.includes(marker), `dist/index.js is missing ${marker}`);
  }
  // The browser-safe root entry must not reach the CLI by ANY path. The previous
  // check only looked for the literal './cli/generate-types.js', so a re-export
  // one level up ('./cli/index.js') slipped through and dragged fs/promises into
  // client bundles. Match any import/export statement targeting ./cli/ instead.
  check(
    !/(?:from|import)\s*\(?\s*['"]\.\/cli\//.test(indexContent),
    'dist/index.js should not export CLI modules',
  );
}

// The node entry is the one that may reach the CLI, and must, so root imports keep
// resolving `generateTypes` under Node.
const nodeIndexPath = path.join(distDir, 'index.node.js');
if (fs.existsSync(nodeIndexPath)) {
  const nodeIndexContent = fs.readFileSync(nodeIndexPath, 'utf8');
  check(
    nodeIndexContent.includes('./cli/index.js'),
    'dist/index.node.js should re-export the CLI helpers',
  );
  check(
    nodeIndexContent.includes('./index.js'),
    'dist/index.node.js should re-export the browser-safe root entry',
  );
}

const binPath = path.join(distDir, 'cli', 'bin.js');
if (fs.existsSync(binPath)) {
  const binContent = fs.readFileSync(binPath, 'utf8');
  check(binContent.startsWith('#!/usr/bin/env node'), 'dist/cli/bin.js is missing the node shebang');
  if (process.platform !== 'win32') {
    check(Boolean(fs.statSync(binPath).mode & fs.constants.S_IXUSR), 'dist/cli/bin.js is not executable');
  }
}

const allFiles = [];
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    const relative = path.join(prefix, entry);
    if (fs.statSync(target).isDirectory()) {
      walk(target, relative);
    } else {
      allFiles.push(relative);
    }
  }
}
if (fs.existsSync(distDir)) {
  walk(distDir);
  fs.writeFileSync(path.join(rootDir, 'dist-file-index.txt'), allFiles.join('\n'));
}

if (failures.length > 0) {
  console.error('Build verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Build verification passed.');
