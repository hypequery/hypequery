import { runHttpMcp } from '../utils/mcp-http.js';
import { exitWith } from '../utils/command-exit.js';
import { runMcpUntilSignal, type CloseableMcpServer } from '../utils/mcp-lifecycle.js';
import { routeConsoleOutputToStderr } from '../utils/mcp-console.js';
import { datasetsWithoutTenantKey, readServeMcpSource, tenantScopedDatasets, type ServeMcpSource } from '../utils/mcp-source.js';
import path from 'node:path';
import { findApiFileForPath, findQueriesFile } from '../utils/find-files.js';
import { loadApiModule } from '../utils/load-api.js';
import { importFromProject } from '../utils/project-root.js';
import { logger } from '../utils/logger.js';
import { MCP_API_KEY_VARIABLE } from '../utils/hosted-endpoints.js';
import { checkRemoteMcp, type RemoteMcpCheck } from '../utils/mcp-remote-check.js';
import { McpSession } from '../utils/telemetry/mcp-session.js';
import { countBucket } from '../utils/telemetry/buckets.js';
import { entryType } from '../utils/telemetry/session-config.js';
import { updateCommandTelemetry, setCommandTelemetryError } from '../utils/telemetry/command-context.js';
import { CliError } from '../utils/cli-error.js';
import { emitResult } from '../utils/machine-output.js';
import {
  httpServerPackage,
  mcpHttpSettings,
  McpHttpUsageError,
  MCP_SERVER_KEY_VARIABLE,
  runMcpHttpServer,
  type McpHttpOptions,
  type McpHttpSettings,
} from '../utils/mcp-http-server.js';

export interface McpOptions extends McpHttpOptions {
  /** Analytics directory, matching `hypequery dev --path`. */
  path?: string;
  /** Trusted tenant applied to every tenant-scoped dataset. */
  tenant?: string;
  /** Check the entrypoint and exit instead of speaking MCP over stdio. */
  selfTest?: boolean;
  /** With `selfTest`: check this hosted MCP endpoint instead of a local entrypoint. */
  url?: string;
  /** Authorized HTTP client-contract discovery; no local analytics entrypoint. */
  clientContractUrl?: string;
}

export interface McpDependencies {
  loadApi?: (file: string) => Promise<unknown>;
  start?: (config: {
    datasets: Record<string, unknown>;
    analytics: unknown;
    tenantId?: string;
  }) => Promise<CloseableMcpServer>;
  /** Loads the optional `@hypequery/mcp` peer; injected in tests. */
  loadMcp?: () => Promise<unknown>;
  checkRemote?: (input: { url: string; key: string }) => Promise<RemoteMcpCheck>;
  env?: Readonly<Record<string, string | undefined>>;
  /** Serves `--http`; injected in tests. */
  serveHttp?: typeof runMcpHttpServer;
}

const HTTP_ONLY_FLAGS: readonly (keyof McpHttpOptions)[] = [
  'port', 'host', 'allowedHosts', 'allowedOrigins', 'resource', 'authorizationServers', 'requiredScopes',
];

/** Validate `--http` flags up front, so a bad combination fails before anything loads. */
function httpSettings(options: McpOptions, dependencies: McpDependencies): McpHttpSettings | undefined {
  if (!options.http) {
    const stray = HTTP_ONLY_FLAGS.filter(flag => options[flag] !== undefined);
    if (stray.length > 0) fail(`--${stray[0].replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} is only used with --http.`);
    return undefined;
  }
  if (options.selfTest || options.url) fail('--http serves MCP; it cannot be combined with --self-test or --url.');
  try {
    return mcpHttpSettings(options, dependencies.env ?? process.env);
  } catch (error) {
    if (error instanceof McpHttpUsageError) fail(error.message, error.hints);
    throw error;
  }
}

async function loadHttpServer(load: () => Promise<unknown>): Promise<ReturnType<typeof httpServerPackage>> {
  try {
    return httpServerPackage(await load());
  } catch (error) {
    if (error instanceof McpHttpUsageError) fail(error.message, error.hints);
    fail('@hypequery/mcp is not installed, so this project cannot be served over MCP.', ['npm install @hypequery/mcp']);
  }
}

function fail(message: string, hints: readonly string[] = []): never {
  logger.error(message);
  if (hints.length > 0) {
    logger.newline();
    for (const hint of hints) logger.indent(hint);
  }
  logger.newline();
  exitWith(1, 'failure', 'validation_failed');
}

/** `--self-test --url`: initialize and list tools against a hosted endpoint. */
async function remoteSelfTest(url: string, dependencies: McpDependencies): Promise<void> {
  const key = (dependencies.env ?? process.env)[MCP_API_KEY_VARIABLE]?.trim();
  if (!key) {
    fail(`Set ${MCP_API_KEY_VARIABLE} to a runtime API key to check a hosted endpoint.`, [
      'Create one in Cloud under Keys. It is read from the environment so it never',
      'appears in your shell history.',
    ]);
  }
  const result = await (dependencies.checkRemote ?? checkRemoteMcp)({ url, key });
  if (!result.ok) {
    throw new CliError('MCP_CHECK_FAILED', `Hosted MCP check failed: ${result.reason}`, {
      exitClass: result.kind === 'auth' ? 'auth' : result.kind === 'unavailable' ? 'transient' : 'correctable',
      ...(result.kind === 'auth' ? { hint: `Check ${MCP_API_KEY_VARIABLE} and the key's scopes in Cloud under Keys.` } : {}),
      ...(result.kind === 'input' ? { hint: 'Check the --url: it must be the https MCP URL `deployment:status` prints.' } : {}),
    });
  }
  logger.success(`Connected to ${result.server ?? 'the hosted MCP endpoint'}`);
  logger.info(`Tools: ${result.tools}`);
  logger.newline();
  logger.info('The hosted endpoint is ready for MCP clients. No tool was called.');
  emitResult({ ok: true, mode: 'hosted', url, server: result.server ?? null, tools: result.tools });
}

function entrypointNotFound(): never {
  logger.error('Could not find a hypequery API file to serve over MCP');
  logger.newline();
  logger.info('Expected one of:');
  for (const candidate of [
    'hypequery.ts', 'analytics/api.ts', 'src/analytics/api.ts',
    'api.ts', 'src/api.ts', 'analytics/queries.ts', 'src/analytics/queries.ts',
  ]) {
    logger.indent(`• ${candidate}`);
  }
  logger.newline();
  logger.info('Or specify the file explicitly:');
  logger.indent('hypequery mcp ./path/to/api.ts');
  logger.newline();
  exitWith(1, 'failure', 'entrypoint_not_found');
}

function noDatasets(file: string): never {
  logger.error(`${path.relative(process.cwd(), file)} does not register any datasets`);
  logger.newline();
  logger.info('MCP exposes datasets and named metrics, so add them to defineServe:');
  logger.indent('defineServe({ queryBuilder: db, datasets: { orders: Orders } })');
  logger.newline();
  exitWith(1, 'failure', 'no_datasets');
}

async function resolveEntrypoint(file: string | undefined, options: McpOptions): Promise<string> {
  const resolved = file
    ? await findQueriesFile(file)
    : options.path
      ? await findApiFileForPath(options.path)
      : await findQueriesFile();
  return resolved ?? entrypointNotFound();
}

function resolveSource(api: unknown, file: string): ServeMcpSource {
  return readServeMcpSource(api) ?? noDatasets(file);
}

export async function mcpCommand(
  file?: string,
  options: McpOptions = {},
  dependencies: McpDependencies = {},
): Promise<void> {
  const telemetry = new McpSession();
  updateCommandTelemetry('mcp', { mode: options.selfTest ? 'self_test' : 'serve', hosted: !!options.url, tenant_used: !!options.tenant, http_backend: !!options.clientContractUrl });
  if (options.clientContractUrl !== undefined && (file !== undefined || options.path !== undefined || options.tenant !== undefined || options.url !== undefined)) {
    fail('--client-contract-url cannot be combined with a file, --path, --tenant or --url.');
  }
  if (options.url && !options.selfTest) {
    fail('--url is only used with --self-test.', [
      'MCP clients connect to the hosted endpoint directly; this command serves a local project.',
    ]);
  }
  const http = httpSettings(options, dependencies);
  const restoreConsole = routeConsoleOutputToStderr();
  try {
    if (options.clientContractUrl !== undefined) {
      if (http) {
        await serveBridgeOverHttp(options.clientContractUrl, http, dependencies, telemetry);
        return;
      }
      await runHttpMcp(options.clientContractUrl, !!options.selfTest, dependencies, telemetry);
      return;
    }
    if (options.url) {
      await remoteSelfTest(options.url, dependencies);
      return;
    }
    const entrypoint = await resolveEntrypoint(file, options);
    const loadApi = dependencies.loadApi ?? loadApiModule;
    let api: unknown;
    try { api = await loadApi(entrypoint); }
    catch (error) { setCommandTelemetryError('load_error'); throw error; }
    const source = resolveSource(api, entrypoint);
    const datasets = source.datasets as Record<string, unknown>;

    const names = Object.keys(datasets).sort();
    if (names.length === 0) noDatasets(entrypoint);

    const scoped = tenantScopedDatasets(datasets);
    updateCommandTelemetry('mcp', { dataset_count_bucket: countBucket(names.length), tenant_dataset_count_bucket: countBucket(scoped.length) });
    // Over HTTP with the application's own auth, each caller's tenant comes from its credential.
    const tenantFromCredential = !!http && !http.staticKey && !!source.auth;
    if (http && !http.staticKey && !source.auth) {
      fail(`--http needs a credential check: set ${MCP_SERVER_KEY_VARIABLE}, or configure auth in defineServe.`, [
        `${MCP_SERVER_KEY_VARIABLE} is one shared key for one principal; defineServe auth (for example`,
        'createJwtStrategy) verifies each caller and assigns its tenant like the REST API.',
      ]);
    }
    if (tenantFromCredential && (source.restricted?.length ?? 0) > 0) {
      // Callers are told apart by their credentials, so a rule that decides who may query a
      // dataset must hold here too. This path applies only the global auth and tenant.
      const listed = source.restricted!.map(entry => `${entry.kind === 'metric' ? 'metric ' : ''}${entry.name} (${entry.rules.join(', ')})`);
      fail(`--http cannot apply the access rules these entries declare: ${listed.join(', ')}`, [
        'Callers are verified by defineServe auth, but each entry\'s own auth, roles, scopes,',
        'middlewares and tenant override are not applied, so a caller could query data REST would refuse them.',
        `Remove those options, or serve one trusted principal: ${MCP_SERVER_KEY_VARIABLE}=<key> hypequery mcp --http`,
      ]);
    }
    const globalMiddlewares = source.globalMiddlewareCount?.() ?? 0;
    if (tenantFromCredential && globalMiddlewares > 0) {
      // A global middleware may refuse a verified caller over REST; MCP would not run it.
      fail(`--http cannot apply the ${globalMiddlewares} global middleware(s) defineServe runs before every endpoint.`, [
        'Callers are verified by defineServe auth, but defineServe({ middlewares }) and api.use() are not',
        'run over MCP, so a caller could query data a middleware would refuse them over REST.',
        `Remove those middlewares, or serve one trusted principal: ${MCP_SERVER_KEY_VARIABLE}=<key> hypequery mcp --http`,
      ]);
    }
    const untenanted = tenantFromCredential && source.auth?.tenant ? datasetsWithoutTenantKey(datasets) : [];
    if (untenanted.length > 0) {
      // REST refuses a caller that has a tenant on a dataset with no tenantKey, since no tenant
      // filter can be added to it. MCP would return every row, so refuse to serve it.
      fail(`--http cannot tenant-scope these datasets, which have no tenantKey: ${untenanted.join(', ')}`, [
        'defineServe assigns each caller a tenant, and REST refuses to run a dataset without a tenantKey for',
        'a caller that has one. Over MCP the query would not be filtered to the caller\'s tenant.',
        `Add a tenantKey to those datasets, or serve one trusted principal: ${MCP_SERVER_KEY_VARIABLE}=<key> hypequery mcp --http`,
      ]);
    }
    if (tenantFromCredential && options.tenant) {
      fail('--tenant cannot be combined with defineServe auth over --http; the credential names the tenant.');
    }
    if (scoped.length > 0 && !options.tenant && !tenantFromCredential) {
      // Fail closed rather than serving a tenant-scoped dataset unscoped.
      logger.error(`--tenant is required for tenant-scoped datasets: ${scoped.join(', ')}`);
      logger.newline();
      logger.info('MCP has no request to resolve a tenant from, so it must be given one:');
      logger.indent('hypequery mcp --tenant acme');
      logger.newline();
      exitWith(1, 'failure', 'tenant_required');
    }

    const analytics = source.resolveAnalytics();

    if (options.selfTest) {
      // Serving needs the optional `@hypequery/mcp` peer. Without this check
      // the self-test passed and the real command then failed on import.
      try {
        await (dependencies.loadMcp ?? (() => loadMcpPackage(entrypoint)))();
      } catch {
        fail('@hypequery/mcp is not installed, so this project cannot be served over MCP.', [
          'npm install @hypequery/mcp',
        ]);
      }
      logger.success(`Loaded ${path.relative(process.cwd(), entrypoint)}`);
      logger.info(`Datasets: ${names.join(', ')}`);
      logger.info(options.tenant
        ? `Trusted tenant: ${options.tenant}`
        : 'Trusted tenant: none (no dataset is tenant-scoped)');
      logger.newline();
      logger.info('The entrypoint is ready to serve over MCP.');
      emitResult({ ok: true, mode: 'local', entrypoint: path.resolve(entrypoint), datasets: names, tenant: options.tenant ?? null });
      return;
    }

    if (http) {
      const mcp = await loadHttpServer(dependencies.loadMcp ?? (() => loadMcpPackage(entrypoint)));
      const authenticate = http.staticKey
        ? mcp.createMCPStaticKeyAuthenticator({ key: http.staticKey, ...(options.tenant ? { tenantId: options.tenant } : {}) })
        : requireTenantFor(scoped, mcp, createServeAuthenticator(mcp, source.auth!, http.oauth?.resource));
      if (http.staticKey && (source.restricted?.length ?? 0) > 0) {
        // One shared key is one principal, so a rule that tells callers apart cannot apply.
        const names = source.restricted!.map(entry => `${entry.kind === 'metric' ? 'metric ' : ''}${entry.name}`).join(', ');
        process.stderr.write(
          `hypequery MCP: every holder of ${MCP_SERVER_KEY_VARIABLE} can query ${names}, whatever their own `
          + 'access rules (auth, roles, scopes, middlewares, tenant) say; those are not applied over MCP.\n',
        );
      }
      if (http.staticKey && globalMiddlewares > 0) {
        process.stderr.write(
          `hypequery MCP: the ${globalMiddlewares} global middleware(s) defineServe runs before every endpoint `
          + `are not run over MCP; every holder of ${MCP_SERVER_KEY_VARIABLE} bypasses them.\n`,
        );
      }
      await (dependencies.serveHttp ?? runMcpHttpServer)({
        mcp,
        settings: http,
        authenticate,
        createExecutor: principal => mcp.createMCPExecutor({
          datasets: datasets as Parameters<typeof mcp.createMCPExecutor>[0]['datasets'],
          analytics: analytics as Parameters<typeof mcp.createMCPExecutor>[0]['analytics'],
          ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
        }),
        instrument: executor => telemetry.instrument(executor),
        describe: `hypequery MCP serving ${names.length} dataset(s) over HTTP: ${names.join(', ')}`,
        onStarted: () => telemetry.start({ entry_type: entryType(entrypoint, file), mode: 'serve', dataset_count_bucket: countBucket(names.length)!,
          tenant_used: !!options.tenant || tenantFromCredential, tenant_dataset_count_bucket: countBucket(scoped.length)! }),
      });
      return;
    }

    const start = dependencies.start ?? ((config) => defaultStart(entrypoint, config, telemetry));
    await runMcpUntilSignal(async () => {
      const server = await start({
        datasets,
        analytics,
        ...(options.tenant ? { tenantId: options.tenant } : {}),
      });
      telemetry.start({ entry_type: entryType(entrypoint, file), mode: 'serve', dataset_count_bucket: countBucket(names.length)!,
        tenant_used: !!options.tenant, tenant_dataset_count_bucket: countBucket(scoped.length)! });
      process.stderr.write(`hypequery MCP serving ${names.length} dataset(s): ${names.join(', ')}\n`);
      return server;
    });
  } finally {
    restoreConsole();
  }
}

type McpPackage = typeof import('@hypequery/mcp');

/**
 * Tenant-scoped datasets must never run unscoped: a verified caller whose
 * credential names no tenant is refused before a session opens.
 */
function requireTenantFor(
  scoped: readonly string[],
  mcp: Pick<McpPackage, 'MCPHttpAuthError'>,
  authenticate: import('@hypequery/mcp').MCPHttpAuthenticator,
): import('@hypequery/mcp').MCPHttpAuthenticator {
  if (scoped.length === 0) return authenticate;
  return async (request) => {
    const principal = await authenticate(request);
    if (principal && !principal.tenantId) {
      throw new mcp.MCPHttpAuthError('insufficient_scope', 'The credential names no tenant.');
    }
    return principal;
  };
}

/**
 * Verify callers with the application's own auth. With OAuth, a JWT strategy that would also accept
 * tokens issued for another API is refused, so only tokens naming this resource open a session.
 */
function createServeAuthenticator(
  mcp: Pick<McpPackage, 'createMCPServeAuthenticator'>,
  auth: NonNullable<ServeMcpSource['auth']>,
  resource: string | undefined,
): import('@hypequery/mcp').MCPHttpAuthenticator {
  type Options = Parameters<typeof mcp.createMCPServeAuthenticator>[0];
  try {
    return mcp.createMCPServeAuthenticator({
      strategies: auth.strategies as Options['strategies'],
      ...(auth.tenant ? { tenant: auth.tenant as Options['tenant'] } : {}),
      ...(resource ? { audience: resource } : {}),
    });
  } catch (error) {
    if (error instanceof TypeError) fail(error.message.replace(/^createMCPServeAuthenticator: /, ''), [
      'Set the audience of createJwtStrategy to the --resource URL, and no other.',
    ]);
    throw error;
  }
}

/** `--client-contract-url --http`: one backend principal, so only the static key may call. */
async function serveBridgeOverHttp(
  url: string,
  http: McpHttpSettings,
  dependencies: McpDependencies,
  telemetry: McpSession,
): Promise<void> {
  if (!http.staticKey) {
    fail(`--client-contract-url --http serves one backend principal; set ${MCP_SERVER_KEY_VARIABLE} for its callers.`, [
      'The backend credential stays HYPEQUERY_API_KEY and is never forwarded from callers.',
    ]);
  }
  const mcp = await loadHttpServer(dependencies.loadMcp ?? (() => import('@hypequery/mcp')));
  const full = mcp as unknown as McpPackage;
  if (typeof full.createMCPHttpExecutor !== 'function') {
    fail('Upgrade @hypequery/mcp in this project to a version with createMCPHttpExecutor support.');
  }
  const key = (dependencies.env ?? process.env)[MCP_API_KEY_VARIABLE]?.trim();
  await (dependencies.serveHttp ?? runMcpHttpServer)({
    mcp,
    settings: http,
    authenticate: mcp.createMCPStaticKeyAuthenticator({ key: http.staticKey }),
    createExecutor: (_principal, signal) => full.createMCPHttpExecutor(
      { url, ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}) },
      signal,
    ),
    instrument: executor => telemetry.instrument(executor),
    describe: 'hypequery MCP serving an authorized HTTP client contract over HTTP.',
    onStarted: () => telemetry.start({ mode: 'serve', tenant_used: false, http_backend: true }),
  });
}

/**
 * Prefers the project's own `@hypequery/mcp`, so `npx -y @hypequery/cli mcp`
 * run from another directory still finds the optional peer.
 */
function loadMcpPackage(entrypoint: string): Promise<McpPackage> {
  return importFromProject<McpPackage>('@hypequery/mcp', entrypoint, () => import('@hypequery/mcp'));
}

async function defaultStart(entrypoint: string, config: {
  datasets: Record<string, unknown>;
  analytics: unknown;
  tenantId?: string;
}, telemetry: McpSession): Promise<CloseableMcpServer> {
  // Imported lazily so `--self-test` and the argument errors above do not pay
  // for the MCP SDK, and so the CLI still loads when it is not installed.
  // The project's own copy, so a client launching from another directory
  // still finds the optional peer; the executor stays telemetry-instrumented.
  const { createMCPExecutor, createMCPProtocolServer, connectMCPServerStdio } =
    await loadMcpPackage(entrypoint);
  const executor = createMCPExecutor(config as Parameters<typeof createMCPExecutor>[0]);
  const server = createMCPProtocolServer({ executor: telemetry.instrument(executor) });
  try { await connectMCPServerStdio(server); }
  catch (error) { await server.close().catch(() => undefined); throw error; }
  return server;
}
