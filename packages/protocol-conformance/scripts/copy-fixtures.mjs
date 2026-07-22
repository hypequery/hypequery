// Snapshots the language-neutral conformance fixtures into the package so a
// published build is self-contained and can be run with `npx` from another
// repository. The copied `fixtures/` directory is gitignored; the source of
// truth stays in `specs/security-protocol/fixtures/`.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../../specs/security-protocol/fixtures');
const destination = resolve(here, '../fixtures');

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

process.stdout.write(`Copied conformance fixtures to ${destination}\n`);
