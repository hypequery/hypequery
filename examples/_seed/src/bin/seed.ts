#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from '../config.js';
import { createSeedClient } from '../client.js';
import { DEFAULT_EVENT_COUNT } from '../generator.js';
import { clickhouseVersion, readChecksumFile, seed, verify, writeChecksumFile } from '../seed.js';
import { computeChecksums, formatChecksumTable } from '../checksums.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const config = configFromEnv();
const eventCount = Number(value('rows') ?? DEFAULT_EVENT_COUNT);
const options = { config, packageRoot, eventCount, log: (line: string) => console.log(line) };

async function main(): Promise<void> {
  console.log(`ClickHouse ${config.url}, database ${config.database}`);

  if (flag('check')) {
    await verify(options);
    console.log('Seed checksums match checksums.json.');
    return;
  }

  const started = Date.now();
  const checksums = await seed(options);
  console.log(`\nSeeded in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  console.log(formatChecksumTable(checksums));

  if (flag('write-checksums')) {
    const client = createSeedClient(config);
    const version = await clickhouseVersion(client).finally(() => client.close());
    writeChecksumFile(packageRoot, { clickhouse: version, eventCount, tables: checksums });
    console.log(`\nWrote checksums.json (ClickHouse ${version}).`);
    return;
  }

  if (eventCount !== DEFAULT_EVENT_COUNT) {
    console.log(`\nSkipping checksum verification: --rows=${eventCount} is not the pinned ${DEFAULT_EVENT_COUNT}.`);
    return;
  }
  await verify(options, checksums);
  const pinned = readChecksumFile(packageRoot);
  console.log(`\nChecksums match checksums.json (produced on ClickHouse ${pinned?.clickhouse}).`);
}

main().catch(async (error: unknown) => {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  if (flag('debug')) console.error(error);
  // Surface the live state so a CI log is enough to diagnose a mismatch.
  if (!flag('check')) {
    try {
      const client = createSeedClient(config);
      console.error('\nLive checksums:\n' + formatChecksumTable(await computeChecksums(client, config.database)));
      await client.close();
    } catch {
      // The database may not exist; the error above is the real one.
    }
  }
  process.exit(1);
});
