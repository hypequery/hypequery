import type { AutoClientModule } from './auto-client.js';

export function getAutoClientModule(): AutoClientModule {
  throw new Error('Auto-detecting a ClickHouse client is not supported in browser environments.');
}
