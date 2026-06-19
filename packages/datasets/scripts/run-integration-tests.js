#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLICKHOUSE_CONTAINER_NAME,
  DEFAULT_COMPOSE_PATH,
  TEST_CONNECTION_CONFIG,
  detectComposeCommand,
  ensureDockerDaemon,
  ensurePort,
  isContainerRunning,
  logIntegrationMessage,
  seedClickHouseDatabase,
  startClickHouseContainer,
  stopClickHouseContainer,
  waitForClickHouse,
} from '../../../testing/clickhouse/harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

function currentClickHouseConfig() {
  return {
    ...TEST_CONNECTION_CONFIG,
    host: process.env.CLICKHOUSE_TEST_HOST || `http://localhost:${process.env.CLICKHOUSE_TEST_PORT || '8123'}`,
    user: process.env.CLICKHOUSE_TEST_USER || TEST_CONNECTION_CONFIG.user,
    password: process.env.CLICKHOUSE_TEST_PASSWORD || TEST_CONNECTION_CONFIG.password,
    database: process.env.CLICKHOUSE_TEST_DB || TEST_CONNECTION_CONFIG.database,
  };
}

const cliOptions = {
  keepContainer: process.env.KEEP_CLICKHOUSE_CONTAINER === 'true',
  reuseContainer: process.env.REUSE_CLICKHOUSE_CONTAINER === 'true',
  skipSeed: process.env.SKIP_CLICKHOUSE_SEED === 'true',
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

async function runVitest() {
  logIntegrationMessage('Running datasets integration suite...');
  const args = ['vitest', 'run', '--config=vitest.integration.config.ts', ...vitestArgs];

  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: packageRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        DEBUG: process.env.DEBUG ?? 'true',
      },
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const usesExplicitHost = Boolean(process.env.CLICKHOUSE_TEST_HOST);
  if (usesExplicitHost) {
    const config = currentClickHouseConfig();
    await waitForClickHouse({ config });

    if (!cliOptions.skipSeed) {
      await seedClickHouseDatabase({ config });
    } else {
      logIntegrationMessage('Skipping database seed step.');
    }

    const code = await runVitest();
    return { code, compose: null, startedContainer: false };
  }

  await ensureDockerDaemon();
  const resolvedPort = await ensurePort('CLICKHOUSE_TEST_PORT', '8123');
  process.env.CLICKHOUSE_TEST_HOST = `http://localhost:${resolvedPort}`;
  await ensurePort('CLICKHOUSE_TEST_NATIVE_PORT', '9000');
  const compose = await detectComposeCommand();
  const containerRunning = await isContainerRunning(CLICKHOUSE_CONTAINER_NAME);
  let startedContainer = false;

  if (containerRunning) {
    if (cliOptions.reuseContainer) {
      logIntegrationMessage('Reusing existing ClickHouse container.');
    } else {
      logIntegrationMessage('Existing ClickHouse container detected. Restarting for a clean state...');
      await stopClickHouseContainer({ compose, composeFile: DEFAULT_COMPOSE_PATH, logger: logIntegrationMessage });
      await startClickHouseContainer({ compose, composeFile: DEFAULT_COMPOSE_PATH, logger: logIntegrationMessage });
      startedContainer = true;
    }
  } else {
    await startClickHouseContainer({ compose, composeFile: DEFAULT_COMPOSE_PATH, logger: logIntegrationMessage });
    startedContainer = true;
  }

  try {
    const config = currentClickHouseConfig();
    await waitForClickHouse({ config });

    if (!cliOptions.skipSeed) {
      await seedClickHouseDatabase({ config });
    } else {
      logIntegrationMessage('Skipping database seed step.');
    }

    const vitestCode = await runVitest();
    return { code: vitestCode, compose, startedContainer };
  } finally {
    if (startedContainer && cliOptions.keepContainer) {
      logIntegrationMessage('Keeping ClickHouse container alive as requested.');
    } else if (startedContainer && !cliOptions.keepContainer) {
      await stopClickHouseContainer({ compose, composeFile: DEFAULT_COMPOSE_PATH, logger: logIntegrationMessage }).catch(() => {});
    }
  }
}

main()
  .then(({ code }) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error('Integration test runner failed:', error);
    process.exit(1);
  });
