import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'index.js',
  'createHooks.js',
  'errors.js',
  'types.js',
];

const distDir = path.join(process.cwd(), 'dist');
const missing = [];

for (const file of requiredFiles) {
  const filePath = path.join(distDir, file);
  try {
    await access(filePath, constants.F_OK);
    const stats = await stat(filePath);
    if (stats.size === 0) {
      missing.push(`${file} (empty)`);
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      missing.push(file);
    } else {
      throw err;
    }
  }
}

if (missing.length > 0) {
  console.error('Missing dist outputs:', missing.join(', '));
  process.exit(1);
}

console.log('Verified dist outputs:', requiredFiles.join(', '));
