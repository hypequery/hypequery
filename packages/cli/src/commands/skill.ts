import os from 'node:os';
import path from 'node:path';
import { AGENT_SKILLS } from '../templates/skills.generated.js';
import { readGeneratedFile, writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { logger } from '../utils/logger.js';
import { CliError } from '../utils/machine-output/cli-error.js';
import { setCommandTelemetryError } from '../utils/telemetry/command-context.js';

export interface SkillOptions {
  agent?: string;
  scope?: string;
  force?: boolean;
  check?: boolean;
}

export interface SkillDependencies {
  readonly cwd?: string;
  readonly home?: string;
}

/**
 * Where each agent reads `<name>/SKILL.md` skills. Cursor and Codex both read
 * the shared Agent Skills directory, `.agents/skills`; Claude Code reads its own.
 */
const SKILL_ROOTS = {
  claude: '.claude/skills',
  cursor: '.agents/skills',
  codex: '.agents/skills',
} as const;
type Agent = keyof typeof SKILL_ROOTS;
const AGENTS = Object.keys(SKILL_ROOTS) as Agent[];

function selectedAgents(agent = 'all'): Agent[] {
  if (agent === 'all') return AGENTS;
  if ((AGENTS as string[]).includes(agent)) return [agent as Agent];
  throw new CliError('INVALID_INPUT', `Unknown --agent ${agent}; use ${AGENTS.join(', ')} or all.`, {
    issues: [{ path: '--agent', message: `Use ${AGENTS.join(', ')} or all.` }],
  });
}

function base(scope: string | undefined, dependencies: SkillDependencies): string {
  if (scope === undefined || scope === 'project') return dependencies.cwd ?? process.cwd();
  if (scope === 'user') return dependencies.home ?? os.homedir();
  throw new CliError('INVALID_INPUT', `Unknown --scope ${scope}; use project or user.`, {
    issues: [{ path: '--scope', message: 'Use project or user.' }],
  });
}

/** Every skill file the options select, each written once even when agents share a root. */
export function skillTargets(options: SkillOptions, dependencies: SkillDependencies = {}) {
  const directory = base(options.scope, dependencies);
  const roots = [...new Set(selectedAgents(options.agent).map(agent => SKILL_ROOTS[agent]))];
  return roots.flatMap(root => AGENT_SKILLS.map(skill => ({
    file: path.join(directory, root, skill.name, 'SKILL.md'),
    content: skill.content,
  })));
}

/** `hypequery skill install`: write hypequery's agent skills where coding agents load them. */
export async function skillCommand(
  action: string | undefined,
  options: SkillOptions = {},
  dependencies: SkillDependencies = {},
): Promise<SkillCommandResult> {
  if (action !== 'install') throw new CliError('USAGE', 'Usage: hypequery skill install [--agent claude|cursor|codex|all] [--scope project|user]');
  if (options.force && options.check) throw new CliError('USAGE', '--force cannot be combined with --check.');
  const targets = skillTargets(options, dependencies);
  const stale: string[] = [];
  const conflicts: string[] = [];
  const installed: string[] = [];
  const unchanged: string[] = [];
  for (const target of targets) {
    const current = await readGeneratedFile(target.file);
    if (current === target.content) {
      unchanged.push(target.file);
      continue;
    }
    if (options.check || (current !== undefined && !options.force)) {
      (current === undefined || options.check ? stale : conflicts).push(target.file);
      continue;
    }
    await writeGeneratedFileAtomically(target.file, target.content, { overwrite: current !== undefined });
    installed.push(target.file);
    logger.success(`Installed ${path.relative(base(options.scope, dependencies), target.file)}`);
  }
  if (options.check && stale.length > 0) {
    setCommandTelemetryError('output_out_of_date');
    throw new CliError('OUT_OF_DATE', `Skills are missing or out of date: ${stale.join(', ')}. Run hypequery skill install --force.`, {
      hint: 'Run `hypequery skill install --force` to install the current skills.',
      issues: stale.map(file => ({ path: file, message: 'missing or out of date' })),
    });
  }
  if (conflicts.length > 0) {
    throw new CliError('CONFLICT', `Refusing to overwrite edited skills: ${conflicts.join(', ')}. Use --force to replace them.`, {
      issues: conflicts.map(file => ({ path: file, message: 'edited or out of date; pass --force to replace' })),
    });
  }
  logger.success(options.check ? 'hypequery skills are up to date.' : 'hypequery skills are installed.');
  return { upToDate: true, installed, unchanged };
}

/** `hypequery skill install --json`. Paths are absolute. */
export interface SkillCommandResult {
  /** Every selected skill now matches this CLI's version. */
  readonly upToDate: true;
  readonly installed: readonly string[];
  readonly unchanged: readonly string[];
}
