import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { auditClientArtifactFiles } from './utils/npm-client-artifact-audit.mjs';

const directory = path.resolve(process.argv[2] ?? 'artifacts');
const names = await readdir(directory);
for (const name of ['react', 'datasets', 'mcp']) {
  const matches = names.filter(file => file.startsWith(`hypequery-${name}-`) && file.endsWith('.tgz'));
  if (matches.length !== 1) throw new Error(`Expected one ${name} tarball.`);
  const archive = path.join(directory, matches[0]);
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim().split('\n');
  const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }));
  if (metadata.name !== `@hypequery/${name}`) throw new Error('Unexpected client package identity.');
  auditClientArtifactFiles(files);
  console.log(`Client artifact audit passed: ${metadata.name}@${metadata.version}, ${files.length} files.`);
}
