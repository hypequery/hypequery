import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** This repository's copy of Cloud's spec. */
export const SPEC_PATH = path.resolve(here, '../../../specs/cloud-api/operations-v1.json');
/** The committed generated module. */
export const GENERATED_PATH = path.resolve(here, '../src/generated/operations.ts');
