import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** This repository's copy of Cloud's spec. */
export const SPEC_PATH = path.resolve(here, '../../../specs/cloud-api/operations-v1.json');
/** The committed generated module. */
export const GENERATED_PATH = path.resolve(here, '../src/generated/operations.ts');
/**
 * The SHA-256 of the spec as `spec:update` last took it from Cloud. A test
 * fails when the spec no longer matches it, so the copy is only ever Cloud's.
 */
export const SPEC_SOURCE_PATH = path.resolve(here, '../../../specs/cloud-api/operations-v1.source.json');
