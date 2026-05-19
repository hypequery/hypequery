import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '../..');
export const DEFAULT_COMPOSE_PATH = path.resolve(
  REPO_ROOT,
  'packages/clickhouse/docker-compose.test.yml',
);
export const DEFAULT_TEST_DATA_PATH = path.resolve(
  REPO_ROOT,
  'packages/clickhouse/src/core/tests/integration/test-data.json',
);
export const CLICKHOUSE_CONTAINER_NAME = 'hypequery-test-clickhouse';

export const TEST_CONNECTION_CONFIG = {
  host: process.env.CLICKHOUSE_TEST_HOST || `http://localhost:${process.env.CLICKHOUSE_TEST_PORT || '8123'}`,
  user: process.env.CLICKHOUSE_TEST_USER || 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD || 'hypequery_test',
  database: process.env.CLICKHOUSE_TEST_DB || 'test_db',
};

export function normalizeDateValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
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

export function loadTestData(testDataPath = DEFAULT_TEST_DATA_PATH) {
  const rawData = JSON.parse(fs.readFileSync(testDataPath, 'utf8'));

  const testTable = (rawData.test_table ?? []).map(row =>
    pickColumns(
      row,
      ['id', 'name', 'category', 'price', 'created_at', 'is_active', 'tags'],
      { created_at: normalizeDateValue },
    ),
  );

  const users = (rawData.users ?? []).map(row =>
    pickColumns(row, ['id', 'user_name', 'email', 'status', 'created_at'], {
      created_at: normalizeDateValue,
    }),
  );

  const orders = (rawData.orders ?? []).map(row =>
    pickColumns(
      row,
      ['id', 'user_id', 'product_id', 'quantity', 'total', 'status', 'created_at'],
      { created_at: normalizeDateValue },
    ),
  );

  return { test_table: testTable, users, orders };
}

export const TEST_DATA = loadTestData();

export function logIntegrationMessage(message) {
  console.log(`[integration] ${message}`);
}

export function runCommand(command, args, options = {}) {
  const {
    cwd = REPO_ROOT,
    capture = false,
    env = process.env,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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

export async function checkPortAvailability(port) {
  return new Promise(resolve => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '0.0.0.0');
  });
}

export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function ensurePort(envVar, defaultPort, logger = logIntegrationMessage) {
  const preferred = Number(process.env[envVar] ?? defaultPort);
  if (await checkPortAvailability(preferred)) {
    process.env[envVar] = String(preferred);
    return preferred;
  }

  const fallback = await findFreePort();
  process.env[envVar] = String(fallback);
  logger(`Port ${preferred} is in use. Using ${fallback} for ${envVar}.`);
  return fallback;
}

export async function detectComposeCommand() {
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

export async function ensureDockerDaemon() {
  try {
    await runCommand('docker', ['info'], { capture: true });
  } catch {
    throw new Error('Docker does not appear to be running. Please start Docker Desktop/daemon before running integration tests.');
  }
}

export async function isContainerRunning(containerName = CLICKHOUSE_CONTAINER_NAME) {
  try {
    const { stdout } = await runCommand(
      'docker',
      ['ps', '--filter', `name=${containerName}`, '--format', '{{.ID}}'],
      { capture: true },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function startClickHouseContainer({
  compose,
  composeFile = DEFAULT_COMPOSE_PATH,
  logger = logIntegrationMessage,
} = {}) {
  const resolvedCompose = compose ?? await detectComposeCommand();
  logger('Starting ClickHouse container...');
  await runCommand(resolvedCompose.command, [...resolvedCompose.args, '-f', composeFile, 'up', '-d']);
}

export async function stopClickHouseContainer({
  compose,
  composeFile = DEFAULT_COMPOSE_PATH,
  logger = logIntegrationMessage,
} = {}) {
  const resolvedCompose = compose ?? await detectComposeCommand();
  logger('Stopping ClickHouse container...');
  await runCommand(resolvedCompose.command, [...resolvedCompose.args, '-f', composeFile, 'down', '-v']);
}

export async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForClickHouse({
  config = TEST_CONNECTION_CONFIG,
  maxAttempts = 60,
  retryDelayMs = 1000,
  logger = logIntegrationMessage,
} = {}) {
  logger('Waiting for ClickHouse to be ready...');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${config.host}/ping`);
      if (response.ok) {
        logger('ClickHouse is ready.');
        return;
      }
    } catch {}

    await sleep(retryDelayMs);
  }

  throw new Error('Timed out waiting for ClickHouse to become ready.');
}

export async function runSql(sql, {
  config = TEST_CONNECTION_CONFIG,
  includeDatabase = true,
} = {}) {
  const url = new URL('/', config.host);
  url.searchParams.set('user', config.user);
  url.searchParams.set('password', config.password);
  if (includeDatabase) {
    url.searchParams.set('database', config.database);
  }

  const response = await fetch(url, {
    method: 'POST',
    body: sql,
    headers: {
      'Content-Type': 'text/plain',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickHouse query failed (${response.status}): ${text}`);
  }
}

export async function insertRows(table, rows, config = TEST_CONNECTION_CONFIG) {
  if (!rows.length) {
    return;
  }

  const payload = rows.map(row => JSON.stringify(row)).join('\n');
  await runSql(
    `INSERT INTO ${config.database}.${table} FORMAT JSONEachRow\n${payload}\n`,
    { config, includeDatabase: false },
  );
}

export async function seedClickHouseDatabase({
  config = TEST_CONNECTION_CONFIG,
  data = TEST_DATA,
  logger = logIntegrationMessage,
} = {}) {
  logger(`Seeding ClickHouse database "${config.database}"...`);

  await runSql(`CREATE DATABASE IF NOT EXISTS ${config.database}`, {
    config,
    includeDatabase: false,
  });

  const schemaStatements = [
    `DROP TABLE IF EXISTS ${config.database}.test_table`,
    `DROP TABLE IF EXISTS ${config.database}.users`,
    `DROP TABLE IF EXISTS ${config.database}.orders`,
    `CREATE TABLE ${config.database}.test_table (\n      id UInt32,\n      name String,\n      category String,\n      price Float64,\n      created_at Date,\n      is_active Boolean,\n      tags Array(String)\n    ) ENGINE = MergeTree()\n    ORDER BY id`,
    `CREATE TABLE ${config.database}.users (\n      id UInt32,\n      user_name String,\n      email String,\n      status String,\n      created_at Date\n    ) ENGINE = MergeTree()\n    ORDER BY id`,
    `CREATE TABLE ${config.database}.orders (\n      id UInt32,\n      user_id UInt32,\n      product_id UInt32,\n      quantity UInt32,\n      total Float64,\n      status String,\n      created_at Date\n    ) ENGINE = MergeTree()\n    ORDER BY id`,
  ];

  for (const statement of schemaStatements) {
    await runSql(statement, { config, includeDatabase: false });
  }

  await insertRows('test_table', data.test_table ?? [], config);
  await insertRows('users', data.users ?? [], config);
  await insertRows('orders', data.orders ?? [], config);

  logger('Database seeding complete.');
}
