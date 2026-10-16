import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(await readFile(process.argv[2], 'utf8'));
const inputs = Object.keys(metadata.inputs);
if (inputs.some(input => /@hypequery\/(?:serve|datasets|clickhouse|protocol(?:-conformance)?|deployment|mcp|cli)(?:\/|$)|\.py$/.test(input.split('\\').join('/')))) {
  throw new Error('Backend code entered the Python browser consumer bundle.');
}
console.log(`Browser bundle audit passed: ${inputs.length} inputs, no backend packages.`);
