import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isNotFoundError, isRecord } from './runtime-guards.js';
import { sha256 } from './sha256.js';

export interface MigrationChecksumFile {
  version: 1;
  algorithm: 'sha256';
  checksum: string;
  files: Record<string, string>;
}

export interface MigrationIntegrityResult {
  migrationName: string;
  ok: boolean;
  checksum?: string;
  expectedChecksum?: string;
  actualChecksum?: string;
  missingChecksumFile: boolean;
  changedFiles: string[];
  missingFiles: string[];
  extraFiles: string[];
}

const META_DIR_NAME = 'meta';
const CHECKSUM_FILE = 'hypequery.sum';

export async function writeMigrationChecksumFile(migrationDir: string): Promise<MigrationChecksumFile> {
  const checksumFile = await calculateMigrationChecksum(migrationDir);
  await writeFile(
    path.join(migrationDir, CHECKSUM_FILE),
    `${JSON.stringify(checksumFile, null, 2)}\n`,
    'utf8',
  );
  return checksumFile;
}

export async function calculateMigrationChecksum(migrationDir: string): Promise<MigrationChecksumFile> {
  const filePaths = await listMigrationFiles(migrationDir);
  const files: Record<string, string> = {};

  for (const filePath of filePaths) {
    const contents = await readFile(path.join(migrationDir, filePath));
    files[filePath] = sha256(contents);
  }

  let checksumInput = '';
  for (const [filePath, fileHash] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    checksumInput += `${filePath}\0${fileHash}\0`;
  }

  return {
    version: 1,
    algorithm: 'sha256',
    checksum: sha256(checksumInput),
    files,
  };
}

export async function verifyMigrationIntegrity(migrationsOutDir: string): Promise<MigrationIntegrityResult[]> {
  const migrationNames = await listMigrationDirectories(migrationsOutDir);

  return Promise.all(migrationNames.map(async migrationName => {
    const migrationDir = path.join(migrationsOutDir, migrationName);
    const actual = await calculateMigrationChecksum(migrationDir);
    const expected = await readMigrationChecksumFile(migrationDir);

    if (!expected) {
      return {
        migrationName,
        ok: false,
        checksum: actual.checksum,
        actualChecksum: actual.checksum,
        missingChecksumFile: true,
        changedFiles: [],
        missingFiles: [],
        extraFiles: Object.keys(actual.files),
      };
    }

    const expectedFiles = new Set(Object.keys(expected.files));
    const actualFiles = new Set(Object.keys(actual.files));
    const changedFiles = Object.entries(expected.files)
      .filter(([filePath, fileHash]) => actual.files[filePath] !== undefined && actual.files[filePath] !== fileHash)
      .map(([filePath]) => filePath);
    const missingFiles = Array.from(expectedFiles).filter(filePath => !actualFiles.has(filePath));
    const extraFiles = Array.from(actualFiles).filter(filePath => !expectedFiles.has(filePath));
    const ok = expected.checksum === actual.checksum &&
      changedFiles.length === 0 &&
      missingFiles.length === 0 &&
      extraFiles.length === 0;

    return {
      migrationName,
      ok,
      checksum: actual.checksum,
      expectedChecksum: expected.checksum,
      actualChecksum: actual.checksum,
      missingChecksumFile: false,
      changedFiles,
      missingFiles,
      extraFiles,
    };
  }));
}

async function listMigrationDirectories(migrationsOutDir: string) {
  try {
    const entries = await readdir(migrationsOutDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && entry.name !== META_DIR_NAME)
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function listMigrationFiles(migrationDir: string, relativeDir = ''): Promise<string[]> {
  const entries = await readdir(path.join(migrationDir, relativeDir), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMigrationFiles(migrationDir, relativePath));
      continue;
    }
    if (entry.isFile() && relativePath !== CHECKSUM_FILE) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function readMigrationChecksumFile(migrationDir: string): Promise<MigrationChecksumFile | null> {
  const checksumPath = path.join(migrationDir, CHECKSUM_FILE);

  try {
    const contents = await readFile(checksumPath, 'utf8');
    const parsed: unknown = JSON.parse(contents);
    if (
      isRecord(parsed) &&
      parsed.version === 1 &&
      parsed.algorithm === 'sha256' &&
      typeof parsed.checksum === 'string' &&
      isStringRecord(parsed.files)
    ) {
      return {
        version: 1,
        algorithm: 'sha256',
        checksum: parsed.checksum,
        files: parsed.files,
      };
    }
    throw new Error(`Invalid migration checksum file: ${path.relative(process.cwd(), checksumPath)}`);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}
