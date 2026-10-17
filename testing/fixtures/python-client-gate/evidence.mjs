import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = process.env.HYPEQUERY_GATE_OUTPUT;
const tutorial = process.env.HYPEQUERY_GATE_TUTORIAL;
const artifacts = {};
for (const name of await readdir(`${tutorial}/artifacts`)) {
  if (!/\.(?:tgz|whl|tar\.gz)$/.test(name)) continue;
  const bytes = await readFile(`${tutorial}/artifacts/${name}`);
  artifacts[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
const versions = {};
for (const name of ['@hypequery/react', '@hypequery/mcp', '@hypequery/cli', '@hypequery/protocol', '@hypequery/datasets', 'react', 'react-dom', '@tanstack/react-query', 'playwright']) {
  versions[name] = JSON.parse(await readFile(path.resolve('node_modules', name, 'package.json'), 'utf8')).version;
}
const contract = JSON.parse(await readFile('contract.json', 'utf8'));
const report = {
  passed: true, sourceSha: (await readFile(`${output}/source-sha.txt`, 'utf8')).trim(),
  worktreeDirty: JSON.parse(await readFile(`${output}/worktree-dirty.txt`, 'utf8')),
  node: process.version, python: (await readFile(`${output}/python-version.txt`, 'utf8')).trim(),
  clickhouse: (await readFile(`${output}/clickhouse-version.txt`, 'utf8')).trim(), versions,
  contentHash: contract.contentHash,
  endpointHashes: Object.fromEntries(contract.endpoints.map(item => [item.id, item.schemaHash])),
  browser: JSON.parse(await readFile(`${output}/browser.json`, 'utf8')),
  cancellation: JSON.parse(await readFile(`${output}/cancellation.json`, 'utf8')),
  mcp: { passed: true }, artifacts, skips: [],
};
await writeFile(`${output}/qualification.json`, JSON.stringify(report, null, 2));
console.log('Qualification report and artifact SHA-256 checksums written.');
