import { CliError } from '../cli-error.js';
import { redactConnectionUrl } from '../redact-connection-url.js';
import { createClickHouseHttpQuery } from './clickhouse-http-query.js';
import { loadOnboardEngine, ONBOARD_ENGINE_PACKAGE, type EngineLoaderDependencies } from './engine-loader.js';
import type {
  ClickHouseAccessProfile,
  ClickHouseConnectionInput,
  ClickHouseQuery,
  DiscoveredSchema,
  OnboardEngine,
} from './engine-types.js';
import { logger } from '../logger.js';
import { cleartextCredentialsWarning, onboardConnectionFromEnv } from './onboard-connection.js';

/** What every onboarding command starts from: the engine, the connection and a transport. */
export interface OnboardSession {
  readonly engine: OnboardEngine;
  readonly input: ClickHouseConnectionInput;
  readonly query: ClickHouseQuery;
}

export interface OnboardSessionDependencies extends EngineLoaderDependencies {
  /** Replaces the installed engine (tests). */
  readonly engine?: OnboardEngine;
  /** Replaces the HTTP transport (tests). */
  readonly query?: ClickHouseQuery;
  /** Replaces the `CLICKHOUSE_*` environment (tests). */
  readonly input?: ClickHouseConnectionInput;
}

let warnedCleartext = false;

/** Warns on stderr, once per process, when credentials would travel in cleartext. */
function warnCleartextOnce(host: string) {
  const warning = cleartextCredentialsWarning(host);
  if (!warning || warnedCleartext) return;
  warnedCleartext = true;
  logger.warn(warning);
}

export async function openOnboardSession(
  command: string,
  options: { readonly databases?: string },
  dependencies: OnboardSessionDependencies = {},
): Promise<OnboardSession> {
  const input = dependencies.input ?? onboardConnectionFromEnv(options.databases);
  warnCleartextOnce(input.host);
  const engine = dependencies.engine ?? await loadOnboardEngine(command, dependencies);
  const query = dependencies.query ?? createClickHouseHttpQuery(engine.modules['clickhouse-query'].ClickHouseConnectionError);
  return { engine, input, query };
}

/**
 * The user's settings profile could not be read. Discovery and every check
 * run under settings derived from it, so nothing can run; retrying won't
 * help until the user's settings change.
 */
function profileUnreadable(step: string): CliError {
  return new CliError('CLICKHOUSE_PROFILE_UNREADABLE',
    `${step}: ClickHouse returned an unexpected settings profile for this user, so no query can be bounded. `
      + 'Check that the ClickHouse user may call getSetting() and that its settings profile sets readonly to 0, 1 or 2.', {
      hint: 'Check the ClickHouse user\'s settings profile (readonly, max_execution_time, max_result_rows and related limits), '
        + 'or connect as a user whose profile ClickHouse reports normally.',
      category: 'correctable_input',
    });
}

/** The engine's `ClickHouseConnectionError` as the CLI's error, by kind. */
export function clickHouseFailure(error: unknown, step: string): unknown {
  const failure = error as { name?: unknown; kind?: unknown; message?: unknown } | undefined;
  if (failure?.name !== 'ClickHouseConnectionError') return error;
  const message = `${step}: ${String(failure.message)}`;
  if (failure.kind === 'access') {
    return new CliError('CLICKHOUSE_ACCESS_DENIED', message, {
      hint: 'Check CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD and the user\'s grants.',
      telemetryCode: 'auth_failed',
      exitClass: 'correctable',
    });
  }
  if (failure.kind === 'query') {
    return new CliError('CLICKHOUSE_QUERY_FAILED', message, {
      hint: 'Check CLICKHOUSE_DATABASE and the user\'s grants on system.tables and system.columns.',
    });
  }
  // The engine reports an unparseable profile as a connection error without an
  // exception code; it is a property of the user's settings, not a network fault.
  if (/unexpected access profile/i.test(String(failure.message))) return profileUnreadable(step);
  return new CliError('CONNECTION_FAILED', message, {
    hint: 'Check CLICKHOUSE_URL and that ClickHouse is running, then retry.',
    category: 'unavailable',
    telemetryCode: 'connection_failed',
  });
}

/**
 * One round trip that proves the credentials work and reads what the user's
 * settings profile enforces, which bounds every later query. The engine's
 * discovery needs the same profile and refuses to run without it, so an
 * unreadable profile fails here with CLICKHOUSE_PROFILE_UNREADABLE.
 */
export async function readAccessProfile(session: OnboardSession): Promise<ClickHouseAccessProfile> {
  const access = session.engine.modules['access-profile'];
  let body: string;
  try {
    body = await session.query(session.input, access.ACCESS_PROFILE_QUERY, { maxBytes: 8192, timeoutMs: 8_000 });
  } catch (error) {
    throw clickHouseFailure(error, `Could not connect to ClickHouse at ${redactConnectionUrl(session.input.host)}`);
  }
  const profile = access.parseAccessProfile(body);
  if (!profile) throw profileUnreadable(`Could not read the settings profile at ${redactConnectionUrl(session.input.host)}`);
  return profile;
}

export async function discover(session: OnboardSession): Promise<DiscoveredSchema> {
  try {
    return await session.engine.modules.introspection.discoverSchema(session.input, session.query);
  } catch (error) {
    throw clickHouseFailure(error, 'Schema discovery failed');
  }
}

/** The engine in a report: which package and version produced it, and from where. */
export function engineInfo(engine: OnboardEngine) {
  return { package: ONBOARD_ENGINE_PACKAGE, version: engine.version, from: engine.from };
}

export function connectionInfo(input: ClickHouseConnectionInput) {
  return {
    host: redactConnectionUrl(input.host),
    database: input.database,
    ...(input.databases ? { databases: input.databases } : {}),
    username: input.username,
  };
}
