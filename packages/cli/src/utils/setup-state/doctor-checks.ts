import { projectServers, type SetupState } from './collect.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
  /** The command or action that fixes it; absent when nothing needs doing. */
  readonly fix?: string;
}

const PASSWORD_RULE = 'Never paste the password into a chat: put CLICKHOUSE_PASSWORD in .env yourself, or run `npx hypequery init` in your own terminal.';

/** Turn the collected state into checks, each naming its fix. Pure, so every case is testable. */
export function doctorChecks(state: SetupState): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(state.node.supported
    ? { id: 'node', status: 'ok', message: `Node ${state.node.version}` }
    : { id: 'node', status: 'fail', message: `Node ${state.node.version} is older than ${state.node.minimum}.`, fix: 'Install Node 24 (for example `nvm install 24`) and run the command again.' });

  checks.push(state.cli.inProject
    ? { id: 'cli', status: 'ok', message: `@hypequery/cli ${state.cli.version} is installed in this project` }
    : {
      id: 'cli', status: state.project.packageJson ? 'warn' : 'skip',
      message: `@hypequery/cli ${state.cli.version} is running, but this project does not depend on it.`,
      ...(state.project.packageJson ? { fix: "npm i -D @hypequery/cli '@hypequery/onboard-engine@^0.1'" } : {}),
    });

  const { connection } = state;
  if (!connection.configured) {
    checks.push({ id: 'connection', status: 'fail', message: 'No ClickHouse connection: CLICKHOUSE_URL is not set in the environment or .env.', fix: PASSWORD_RULE });
  } else if (connection.reachable === false) {
    checks.push({ id: 'connection', status: 'fail', message: `Could not query ClickHouse at ${connection.url}: ${connection.error}`, fix: 'Check CLICKHOUSE_URL, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD in .env, and that the server is reachable.' });
  } else {
    const where = `${connection.url} as ${connection.username}, database ${connection.database}`;
    checks.push({
      id: 'connection',
      status: connection.reachable ? 'ok' : 'skip',
      message: connection.reachable ? `Connected to ${where}` : `Configured for ${where} (not tested)`,
    });
    if (!connection.passwordSet) {
      checks.push({ id: 'password', status: 'warn', message: 'CLICKHOUSE_PASSWORD is empty.', fix: PASSWORD_RULE });
    }
    if (connection.readOnly === false) {
      checks.push({
        id: 'read-only', status: 'warn',
        message: `ClickHouse user ${connection.username} can write. Agents only need to read.`,
        fix: 'Use a user with readonly = 1 (for example a settings profile with readonly = 1), or set it on this user.',
      });
    } else if (connection.readOnly === true) {
      checks.push({ id: 'read-only', status: 'ok', message: `ClickHouse user ${connection.username} is read-only` });
    }
  }

  if (state.envFile.exists) {
    if (state.envFile.gitIgnored === false) {
      checks.push({ id: 'env-ignored', status: 'fail', message: '.env holds credentials but git does not ignore it.', fix: 'Add `.env` to .gitignore.' });
    }
    if (state.envFile.worldReadable) {
      checks.push({ id: 'env-permissions', status: 'warn', message: 'Other users on this machine can read .env.', fix: 'chmod 600 .env' });
    }
  }

  if (state.project.datasetsFile) {
    checks.push({ id: 'datasets', status: 'ok', message: `Datasets: ${state.project.datasetsFile}` });
  } else {
    checks.push({ id: 'datasets', status: 'warn', message: 'No datasets file yet.', fix: 'hypequery next' });
  }
  if (state.project.apiFile) {
    checks.push({ id: 'serve-api', status: 'ok', message: `Serve API: ${state.project.apiFile}` });
    if (!state.project.mcpPackage) {
      checks.push({ id: 'mcp-package', status: 'warn', message: '@hypequery/mcp is not installed, so `hypequery mcp` cannot start.', fix: 'npm i -D @hypequery/mcp' });
    }
  }

  if (state.cloud.signedIn) {
    const until = state.cloud.expiresAt ? ` until ${state.cloud.expiresAt}` : '';
    checks.push({ id: 'cloud', status: 'ok', message: `Signed in to hypequery Cloud (${state.cloud.source})${until}` });
  } else {
    checks.push({
      id: 'cloud', status: state.cloud.unreadable ? 'warn' : 'skip',
      message: state.cloud.unreadable ? 'A stored Cloud credential could not be read.' : 'Not signed in to hypequery Cloud (only needed to deploy).',
      fix: 'hypequery login --device --no-wait',
    });
  }

  if (state.agents.length === 0) {
    checks.push({ id: 'agents', status: 'warn', message: 'No coding agent found (Claude Code, Cursor, Codex or Claude Desktop).', fix: 'hypequery mcp:install --agent <agent>' });
  }
  for (const agent of state.agents) {
    if (agent.error) {
      checks.push({ id: `mcp:${agent.client}`, status: 'fail', message: `${agent.client}: ${agent.error}` });
      continue;
    }
    if (agent.servers.length === 0) {
      // Informational: the project-level check below is the one to act on.
      checks.push({ id: `mcp:${agent.client}`, status: 'skip', message: `${agent.client} has no hypequery MCP server.`, fix: `hypequery mcp:install --agent ${agent.client}` });
      continue;
    }
    for (const server of agent.servers) {
      if (server.missingExecutables.length > 0) {
        checks.push({
          id: `mcp:${agent.client}:${server.name}`, status: 'fail',
          message: `${agent.client}'s "${server.name}" server starts ${server.missingExecutables.join(' and ')}, which no longer exist${server.missingExecutables.length === 1 ? 's' : ''}.`,
          fix: `hypequery mcp:install --agent ${agent.client}`,
        });
      } else {
        checks.push({ id: `mcp:${agent.client}:${server.name}`, status: 'ok', message: `${agent.client}: "${server.name}" (${server.kind}, ${server.scope}) in ${server.file}` });
      }
    }
  }
  if (state.agents.length > 0 && state.project.apiFile && projectServers(state).length === 0 && !state.agents.some(agent => agent.servers.some(server => server.kind === 'hosted'))) {
    checks.push({ id: 'mcp:project', status: 'warn', message: 'No agent serves this project over MCP.', fix: 'hypequery mcp:install' });
  }

  const skills = state.skills.user === 'current' || state.skills.project === 'current' ? 'current'
    : state.skills.user === 'outdated' || state.skills.project === 'outdated' ? 'outdated' : 'missing';
  checks.push(skills === 'current'
    ? { id: 'skills', status: 'ok', message: 'hypequery skills are installed' }
    : { id: 'skills', status: 'warn', message: skills === 'outdated' ? 'hypequery skills are out of date.' : 'hypequery skills are not installed.', fix: `hypequery skill install${skills === 'outdated' ? ' --force' : ''}` });
  return checks;
}
