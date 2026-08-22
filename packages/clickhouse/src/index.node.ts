/**
 * Node entry point for `@hypequery/clickhouse`.
 *
 * Identical to the browser-safe `./index.js`, plus the Node-only CLI helpers.
 * `package.json` maps the package root to this file under the `node` condition
 * and to `./index.js` under `browser`, so bundlers never pull `fs/promises`,
 * `path`, or `dotenv` into a client graph while Node consumers keep every export
 * the root has always had.
 */

export * from './index.js';

/**
 * Introspect a ClickHouse schema and emit TypeScript definitions.
 *
 * Node-only: this reaches the filesystem. Prefer importing it from
 * `@hypequery/clickhouse/cli` in build scripts — that subpath works regardless
 * of which condition the resolver picks.
 */
export { generateTypes } from './cli/index.js';
