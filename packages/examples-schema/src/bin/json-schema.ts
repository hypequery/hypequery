#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSON_SCHEMA_FILES, renderJsonSchema, type JsonSchemaKind } from '../json-schema.js';

// dist/bin/json-schema.js -> package root
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(packageRoot, 'schema');
const check = process.argv.includes('--check');

let stale = 0;
for (const kind of Object.keys(JSON_SCHEMA_FILES) as JsonSchemaKind[]) {
  const target = path.join(outDir, JSON_SCHEMA_FILES[kind]);
  const expected = renderJsonSchema(kind);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === expected) continue;
  if (check) {
    stale += 1;
    console.error(`schema/${JSON_SCHEMA_FILES[kind]} is out of date; run "pnpm --filter @hypequery/examples-schema schema:write"`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(target, expected);
    console.log(`wrote schema/${JSON_SCHEMA_FILES[kind]}`);
  }
}

if (stale > 0) process.exit(1);
if (check) console.log('JSON Schema files are up to date.');
