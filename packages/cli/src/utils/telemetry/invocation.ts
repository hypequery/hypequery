import { COMMON_PROPERTIES, type TelemetryEvent } from './catalog.js';
import type { Properties } from './schema.js';
import { collectEnvironment, type EnvironmentOptions } from './environment.js';
import { inspectProject } from './project-context.js';
import { invocationIdentity } from './identity.js';
import { resolveTelemetryState, type TelemetryResolutionOptions } from './opt-out.js';
import { TelemetryConfigStore } from './config-store.js';
import { showTelemetryNotice } from './notice.js';
import { TelemetryTransport, type TransportOptions } from './transport.js';
import { getCliVersion } from '../cli-version.js';

export type CommonTelemetryProperties = Properties<typeof COMMON_PROPERTIES>;
export interface InvocationOptions extends TelemetryResolutionOptions {
  readonly cwd?: string;
  readonly command: string;
  readonly contextOptions?: EnvironmentOptions;
  readonly transportOptions?: Partial<TransportOptions>;
}

/** One common context and transport per invocation; no automatic user-code loading. */
export class TelemetryInvocation {
  private readonly transport: TelemetryTransport;
  private constructor(readonly common: CommonTelemetryProperties, options: TransportOptions) {
    this.transport = new TelemetryTransport(options);
  }

  static async create(options: InvocationOptions): Promise<TelemetryInvocation | null> {
    try {
      const env = options.env ?? process.env;
      // Collection is staged until the first-party proxy and rollout are ready.
      // Normal runs do not inspect projects or create identities just for telemetry.
      if (!env.HYPEQUERY_TELEMETRY_URL && env.HYPEQUERY_TELEMETRY_DEBUG !== '1') return null;
      if (options.command === 'telemetry') return null;
      const cliVersion = options.cliVersion ?? getCliVersion();
      const state = await resolveTelemetryState({ ...options, cliVersion });
      if (!state.enabled || !state.config) return null;
      const project = inspectProject(options.cwd ?? process.cwd(), options.contextOptions?.read);
      const environment = collectEnvironment(project, { ...options.contextOptions, env, cliVersion });
      const common = { ...environment, ...invocationIdentity(state.config, project), is_first_run: state.source === 'default' };
      const invocation = new TelemetryInvocation(common, {
        ...options.transportOptions,
        enabled: true, endpoint: env.HYPEQUERY_TELEMETRY_URL,
        debug: env.HYPEQUERY_TELEMETRY_DEBUG === '1',
        onDisabled: () => new TelemetryConfigStore(options).disableVersion(cliVersion),
      });
      await showTelemetryNotice({ ...options, enabled: true, isTTY: common.is_tty, isCI: common.is_ci });
      return invocation;
    } catch { return null; }
  }

  record(event: TelemetryEvent): void { this.transport.enqueue(event); }
  flush(): Promise<void> { return this.transport.flush(); }
}
