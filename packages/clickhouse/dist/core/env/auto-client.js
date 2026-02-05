import { createRequire } from 'module';
let cachedModule;
export function getAutoClientModule() {
    if (!cachedModule) {
        try {
            const nodeRequire = createRequire(`${process.cwd()}/noop.js`);
            const clientModule = nodeRequire('@clickhouse/client');
            const settings = clientModule.ClickHouseSettings;
            cachedModule = {
                createClient: clientModule.createClient,
                ClickHouseSettings: settings ?? {}
            };
        }
        catch (error) {
            throw new Error('@clickhouse/client is required for Node.js environments.\n\n' +
                'Install with: npm install @clickhouse/client\n\n' +
                'Alternatively, you can provide a client instance directly in the config.client option.', { cause: error instanceof Error ? error : undefined });
        }
    }
    return cachedModule;
}
