import { logger } from './logger.js';
import {
  MCP_API_KEY_VARIABLE,
  mcpClientConfiguration,
  type HostedEndpoints,
} from './hosted-endpoints.js';

/** Print Cloud's URLs without ever reading or writing runtime API keys. */
export function printHostedEndpoints(endpoints: HostedEndpoints, mcpConfig: boolean): void {
  logger.newline();
  logger.info('Hosted endpoints');
  logger.indent(`REST  ${endpoints.rest.baseUrl}`);
  const width = Math.max(0, ...endpoints.rest.datasets.map((dataset) => dataset.name.length));
  for (const dataset of endpoints.rest.datasets) {
    logger.indent(`  ${dataset.name.padEnd(width)}  POST ${dataset.url}`);
  }
  logger.indent(`MCP   ${endpoints.mcp.url}`);
  logger.newline();
  if (endpoints.active) {
    logger.info(`Set ${MCP_API_KEY_VARIABLE} from your secret store. Check MCP without running a query:`);
    logger.indent(`hypequery mcp --self-test --url ${endpoints.mcp.url}`);
  } else {
    logger.info('These URLs will serve the target after a release is live.');
  }
  if (mcpConfig) {
    logger.newline();
    logger.info(`MCP client configuration (the client reads the key from ${MCP_API_KEY_VARIABLE}):`);
    for (const line of mcpClientConfiguration(endpoints.mcp.url).split('\n')) logger.indent(line);
  }
}
