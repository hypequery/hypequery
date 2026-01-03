#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const composeFile = path.resolve(packageRoot, 'docker-compose.test.yml');
const testDataPath = path.resolve(packageRoot, 'src/core/tests/integration/test-data.json');

const CONTAINER_NAME = 'hypequery-test-clickhouse';
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_TEST_HOST ?? 'http://localhost:8123';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_TEST_USER ?? 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_TEST_PASSWORD ?? 'hypequery_test';
const CLICKHOUSE_DB = process.env.CLICKHOUSE_TEST_DB ?? 'test_db';

const cliOptions = {
  keepContainer: process.env.KEEP_CLICKHOUSE_CONTAINER === 'true',
  reuseContainer: process.env.REUSE_CLICKHOUSE_CONTAINER === 'true',
  skipSeed: process.env.SKIP_CLICKHOUSE_SEED === 'true'
};

const vitestArgs = [];
let forwardAll = false;

for (const arg of process.argv.slice(2)) {
  if (forwardAll) {
    vitestArgs.push(arg);
    continue;
  }

  if (arg === '--') {
    forwardAll = true;
    continue;
  }

  switch (arg) {
    case '--keep-container':
      cliOptions.keepContainer = true;
      break;
    case '--reuse-container':
      cliOptions.reuseContainer = true;
      break;
    case '--skip-seed':
      cliOptions.skipSeed = true;
      break;
    default:
      vitestArgs.push(arg);
      break;
  }
}

function log(message) {
  console.log(`[integration] ${message}`);
}

function runCommand(command, args, { cwd = packageRoot, capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });

    if (!capture) {
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
        } else {
          resolve({ code });
        }
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code ?? 1;
        reject(error);
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function detectComposeCommand() {
  try {
    await runCommand('docker', ['compose', 'version'], { capture: true });
    return { command: 'docker', args: ['compose'] };
  } catch {
    try {
      await runCommand('docker-compose', ['version'], { capture: true });
      return { command: 'docker-compose', args: [] };
    } catch {
      throw new Error('docker compose is required to run integration tests.');
    }
  }
}

async function ensureDockerDaemon() {
  try {
    await runCommand('docker', ['info'], { capture: true });
  } catch (error) {
    throw new Error('Docker does not appear to be running. Please start Docker Desktop/daemon before running integration tests.');
  }
}

async function isContainerRunning() {
  try {
    const { stdout } = await runCommand(
      'docker',
      ['ps', '--filter', `name=${CONTAINER_NAME}`, '--format', '{{.ID}}'],
      { capture: true }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function startContainer(compose) {
  log('Starting ClickHouse container...');
  await runCommand(compose.command, [...compose.args, '-f', composeFile, 'up', '-d']);
}

async function stopContainer(compose) {
  log('Stopping ClickHouse container...');
  await runCommand(compose.command, [...compose.args, '-f', composeFile, 'down', '-v']);
}

async function waitForClickHouse(maxAttempts = 60, delay = 1000) {
  log('Waiting for ClickHouse to be ready...');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${CLICKHOUSE_HOST}/ping`);
      if (response.ok) {
        log('ClickHouse is ready.');
        return;
      }
    } catch {}

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  throw new Error('Timed out waiting for ClickHouse to become ready.');
}

async function runSql(sql, options = { includeDatabase: true }) {
  const url = new URL('/', CLICKHOUSE_HOST);
  url.searchParams.set('user', CLICKHOUSE_USER);
  url.searchParams.set('password', CLICKHOUSE_PASSWORD);
  if (options.includeDatabase) {
    url.searchParams.set('database', CLICKHOUSE_DB);
  }

  const response = await fetch(url, {
    method: 'POST',
    body: sql,
    headers: {
      'Content-Type': 'text/plain'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickHouse query failed (${response.status}): ${text}`);
  }
}

async function insertRows(table, rows) {
  if (!rows.length) {
    return;
  }

  const payload = rows.map(row => JSON.stringify(row)).join('\n');
  const statement = `INSERT INTO ${CLICKHOUSE_DB}.${table} FORMAT JSONEachRow\n${payload}\n`;
  await runSql(statement, { includeDatabase: false });
}

function normalizeDateValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  // Accept either ISO timestamps or space-delimited strings and keep the date portion.
  if (value.includes('T')) {
    return value.split('T')[0];
  }

  if (value.includes(' ')) {
    return value.split(' ')[0];
  }

  return value;
}

function pickColumns(row, columns, transformers = {}) {
  const result = {};
  for (const column of columns) {
    if (!(column in row)) {
      continue;
    }

    const transform = transformers[column];
    result[column] = typeof transform === 'function' ? transform(row[column], row) : row[column];
  }
  return result;
}

async function seedDatabase() {
  log(`Seeding ClickHouse database "${CLICKHOUSE_DB}"...`);
  const rawData = await fs.readFile(testDataPath, 'utf8');
  const data = JSON.parse(rawData);

  await runSql(`CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DB}`, { includeDatabase: false });

  const schemaStatements = [
    `DROP TABLE IF EXISTS ${CLICKHOUSE_DB}.test_table`,
    `DROP TABLE IF EXISTS ${CLICKHOUSE_DB}.users`,
    `DROP TABLE IF EXISTS ${CLICKHOUSE_DB}.orders`,
    `CREATE TABLE ${CLICKHOUSE_DB}.test_table (\n      id UInt32,\n      name String,\n      category String,\n      price Float64,\n      created_at Date,\n      is_active Boolean\n    ) ENGINE = MergeTree()\n    ORDER BY id`,
    `CREATE TABLE ${CLICKHOUSE_DB}.users (\n      id UInt32,\n      user_name String,\n      email String,\n      status String,\n      created_at Date\n    ) ENGINE = MergeTree()\n    ORDER BY id`,
    `CREATE TABLE ${CLICKHOUSE_DB}.orders (\n      id UInt32,\n      user_id UInt32,\n      product_id UInt32,\n      quantity UInt32,\n      total Float64,\n      status String,\n      created_at Date\n    ) ENGINE = MergeTree()\n    ORDER BY id`
  ];

  for (const statement of schemaStatements) {
    await runSql(statement, { includeDatabase: false });
  }

  const testTableRows = (data.test_table ?? []).map(row =>
    pickColumns(
      row,
      ['id', 'name', 'category', 'price', 'created_at', 'is_active'],
      { created_at: normalizeDateValue }
    )
  );

  const userRows = (data.users ?? []).map(row =>
    pickColumns(row, ['id', 'user_name', 'email', 'status', 'created_at'], { created_at: normalizeDateValue })
  );

  const orderRows = (data.orders ?? []).map(row =>
    pickColumns(
      row,
      ['id', 'user_id', 'product_id', 'quantity', 'total', 'status', 'created_at'],
      { created_at: normalizeDateValue }
    )
  );

  await insertRows('test_table', testTableRows);
  await insertRows('users', userRows);
  await insertRows('orders', orderRows);

  log('Database seeding complete.');
}

async function runVitest() {
  log('Running Vitest integration suite...');
  const args = ['vitest', 'run', '--config=vitest.integration.config.ts', ...vitestArgs];
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: packageRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        DEBUG: process.env.DEBUG ?? 'true',
        HYPEQUERY_SKIP_TEST_DB_SETUP: 'true'
      }
    });

    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
}

async function main() {
  await ensureDockerDaemon();
  const compose = await detectComposeCommand();
  const containerRunning = await isContainerRunning();
  let startedContainer = false;

  if (containerRunning) {
    if (cliOptions.reuseContainer) {
      log('Reusing existing ClickHouse container.');
    } else {
      log('Existing ClickHouse container detected. Restarting for a clean state...');
      await stopContainer(compose);
      await startContainer(compose);
      startedContainer = true;
    }
  } else {
    await startContainer(compose);
    startedContainer = true;
  }

  try {
    await waitForClickHouse();

    if (!cliOptions.skipSeed) {
      await seedDatabase();
    } else {
      log('Skipping database seed step.');
    }

    const vitestCode = await runVitest();
    return { code: vitestCode, compose, startedContainer };
  } finally {
    if (startedContainer && cliOptions.keepContainer) {
      log('Keeping ClickHouse container alive as requested.');
    } else if (startedContainer && !cliOptions.keepContainer) {
      await stopContainer(compose).catch(() => {});
    }
  }
}

main()
  .then(({ code }) => {
    process.exit(code);
  })
  .catch(error => {
    console.error('Integration test runner failed:', error);
    process.exit(1);
  });
