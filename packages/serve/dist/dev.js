import { startNodeServer } from "./adapters/node.js";
import { formatQueryEvent } from "./query-logger.js";
const defaultLogger = (message) => {
    console.log(message);
};
export const serveDev = async (api, options = {}) => {
    const port = options.port ?? Number(process.env.PORT ?? 4000);
    const hostname = options.hostname ?? "localhost";
    const logger = options.logger ?? defaultLogger;
    const unsubscribe = api.queryLogger.on((event) => {
        const line = formatQueryEvent(event);
        if (line)
            logger(line);
    });
    const server = await startNodeServer(api.handler, {
        ...options,
        hostname,
        port,
        quiet: true,
    });
    if (!options.quiet) {
        const address = server.server.address();
        const display = typeof address === "object" && address
            ? `${address.address}:${address.port}`
            : `${hostname}:${port}`;
        logger(`hypequery dev server running at http://${display}`);
        logger(`Docs available at http://${display}/docs`);
    }
    return server;
};
