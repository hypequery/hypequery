import { createRequire } from 'module';
import type { ClickHouseSettings } from '@clickhouse/client-common';

type NodeClientModule = typeof import('@clickhouse/client');

export interface AutoClientModule {
  createClient: NodeClientModule['createClient'];
  ClickHouseSettings?: ClickHouseSettings;
}

let cachedModule: AutoClientModule | undefined;

export function getAutoClientModule(): AutoClientModule {
  if (!cachedModule) {
    try {
      const nodeRequire = createRequire(`${process.cwd()}/noop.js`);
      const clientModule: NodeClientModule = nodeRequire('@clickhouse/client');
      const settings = (clientModule as { ClickHouseSettings?: ClickHouseSettings }).ClickHouseSettings;
      cachedModule = {
        createClient: clientModule.createClient,
        ClickHouseSettings: settings ?? {}
      };
    } catch (error) {
      throw new Error(
        '@clickhouse/client is required for Node.js environments.\n\n' +
        'Install with: npm install @clickhouse/client\n\n' +
        'Alternatively, you can provide a client instance directly in the config.client option.',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  return cachedModule;
}
