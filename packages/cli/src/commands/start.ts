import os from 'node:os';
import { collectSetupState, type CollectOptions, type SetupState } from '../utils/setup-state/collect.js';
import { chooseNextStep, renderNextStep } from '../utils/setup-state/next-step.js';
import { emitResult, withoutResult } from '../utils/machine-output.js';
import { logger } from '../utils/logger.js';
import { mcpInstallCommand, type McpInstallChange, type McpInstallDependencies } from './mcp-install.js';
import { skillCommand, skillTargets, type SkillDependencies } from './skill.js';

export interface StartOptions {
  /** Add the hosted hypequery app connector instead of the local server. */
  hosted?: boolean;
  /** Agents for the MCP server (see `mcp:install --agent`). */
  agent?: string;
  /** Scope for the MCP server (see `mcp:install --scope`). */
  scope?: string;
  /** Trusted tenant for tenant-scoped datasets (see `mcp:install --tenant`). */
  tenant?: string;
  /** Leave agents' MCP configuration alone. */
  mcp?: boolean;
  /** Leave the skills alone. */
  skills?: boolean;
  dryRun?: boolean;
}

export interface StartDependencies {
  readonly collect?: CollectOptions;
  readonly mcp?: McpInstallDependencies;
  readonly skill?: SkillDependencies;
}

type StepOutcome = 'done' | 'unchanged' | 'deferred' | 'skipped' | 'failed' | 'planned';

interface StartStep {
  readonly id: 'mcp' | 'skills';
  readonly outcome: StepOutcome;
  readonly detail: string;
  readonly changes?: readonly McpInstallChange[];
}

/** What only the person can do before setup can go on. */
function needs(state: SetupState): string[] {
  const list: string[] = [];
  if (!state.connection.configured) {
    list.push('A ClickHouse connection: the person runs `npx -y @hypequery/cli init` in their own terminal, or puts CLICKHOUSE_URL, CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD in .env. Never ask for the password in chat.');
  } else if (state.connection.reachable === false) {
    list.push(`A working ClickHouse connection: ${state.connection.error}`);
  }
  return list;
}

/**
 * `hypequery start`: one command that sets up everything a coding agent needs,
 * then says what comes next. It installs the skills user-wide and adds the MCP
 * server to the agents on this machine. It never prompts, so it behaves the
 * same in a hidden terminal, under an agent, or in CI: whatever only a person
 * can do (the database password, a sign-in) comes back as `needs`, never as a
 * question it waits on, and nothing is skipped without saying why.
 */
export async function startCommand(options: StartOptions = {}, dependencies: StartDependencies = {}) {
  const hosted = options.hosted === true;
  const steps: StartStep[] = [];
  const before = await collectSetupState({ probe: true, ...dependencies.collect });

  if (options.skills === false) {
    steps.push({ id: 'skills', outcome: 'skipped', detail: 'Skipped (--no-skills).' });
  } else if (options.dryRun) {
    const files = skillTargets({ scope: 'user' }, dependencies.skill);
    const home = dependencies.skill?.home ?? os.homedir();
    steps.push({ id: 'skills', outcome: 'planned', detail: `Would install ${files.length} skill files user-wide, under ${home}.` });
  } else {
    try {
      await withoutResult(() => skillCommand('install', { scope: 'user' }, dependencies.skill));
      steps.push({ id: 'skills', outcome: 'done', detail: 'Skills are installed user-wide (~/.claude/skills and ~/.agents/skills).' });
    } catch (error) {
      steps.push({ id: 'skills', outcome: 'failed', detail: `${(error as Error).message} Run \`hypequery skill install --force\` to replace them.` });
    }
  }

  if (options.mcp === false) {
    steps.push({ id: 'mcp', outcome: 'skipped', detail: 'Skipped (--no-mcp).' });
  } else if (!hosted && !before.project.apiFile) {
    // A local server with nothing to serve fails in the agent's MCP list; add it once the Serve API exists.
    steps.push({ id: 'mcp', outcome: 'deferred', detail: 'Not added yet: this project has no Serve API for `hypequery mcp` to serve. `hypequery next` adds it at the right step, or pass --hosted for the hosted connector.' });
  } else {
    try {
      const exitCode = process.exitCode;
      const changes = await withoutResult(() => mcpInstallCommand({
        hosted, agent: options.agent, scope: options.scope, tenant: options.tenant, dryRun: options.dryRun,
      }, dependencies.mcp));
      // A failed agent is reported in this step; start itself carries on.
      process.exitCode = exitCode;
      const failed = changes.filter(change => change.outcome === 'failed');
      const changed = changes.some(change => ['added', 'updated'].includes(change.outcome));
      steps.push({
        id: 'mcp',
        outcome: failed.length ? 'failed' : options.dryRun ? 'planned' : changed ? 'done' : 'unchanged',
        detail: failed.length ? failed.map(change => `${change.client}: ${change.reason}`).join(' ') : changed ? 'Restart the agent or open a new chat to load it.' : 'Already configured.',
        changes,
      });
    } catch (error) {
      steps.push({ id: 'mcp', outcome: 'failed', detail: (error as Error).message });
    }
  }

  const after = options.dryRun ? before : await collectSetupState({ ...dependencies.collect, probe: false });
  // The connection was tested above; keep that result rather than testing twice.
  const state: SetupState = { ...after, connection: before.connection };
  const next = chooseNextStep(state);
  const waitingOn = needs(state);

  for (const entry of steps) {
    const line = `${entry.id === 'mcp' ? 'MCP server' : 'Skills'}: ${entry.detail}`;
    if (entry.outcome === 'failed') logger.error(line);
    else if (entry.outcome === 'deferred' || entry.outcome === 'skipped') logger.warn(line);
    else logger.success(line);
  }
  if (waitingOn.length) {
    logger.newline();
    logger.info('Needs the person:');
    for (const item of waitingOn) logger.indent(`• ${item}`);
  }
  logger.newline();
  console.log(renderNextStep(next));
  emitResult({ dryRun: options.dryRun === true, hosted, steps, needs: waitingOn, next });
  if (steps.some(entry => entry.outcome === 'failed')) process.exitCode = 1;
}
