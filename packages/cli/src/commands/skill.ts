import os from 'node:os';
import path from 'node:path';
import { AGENT_SKILLS } from '../templates/skills.generated.js';
import { readGeneratedFile, writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { logger } from '../utils/logger.js';
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
  throw new Error(`Unknown --agent ${agent}; use ${AGENTS.join(', ')} or all.`);
}

function base(scope: string | undefined, dependencies: SkillDependencies): string {
  if (scope === undefined || scope === 'project') return dependencies.cwd ?? process.cwd();
  if (scope === 'user') return dependencies.home ?? os.homedir();
  throw new Error(`Unknown --scope ${scope}; use project or user.`);
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
): Promise<void> {
  if (action !== 'install') throw new Error('Usage: hypequery skill install [--agent claude|cursor|codex|all] [--scope project|user]');
  if (options.force && options.check) throw new Error('--force cannot be combined with --check.');
  const targets = skillTargets(options, dependencies);
  const stale: string[] = [];
  const conflicts: string[] = [];
  for (const target of targets) {
    const current = await readGeneratedFile(target.file);
    if (current === target.content) continue;
    if (options.check || (current !== undefined && !options.force)) {
      (current === undefined || options.check ? stale : conflicts).push(target.file);
      continue;
    }
    await writeGeneratedFileAtomically(target.file, target.content, { overwrite: current !== undefined });
    logger.success(`Installed ${path.relative(base(options.scope, dependencies), target.file)}`);
  }
  if (options.check && stale.length > 0) {
    setCommandTelemetryError('output_out_of_date');
    process.exitCode = 1;
    logger.error(`Skills are missing or out of date: ${stale.join(', ')}. Run hypequery skill install --force.`);
    return;
  }
  if (conflicts.length > 0) {
    throw new Error(`Refusing to overwrite edited skills: ${conflicts.join(', ')}. Use --force to replace them.`);
  }
  logger.success(options.check ? 'hypequery skills are up to date.' : 'hypequery skills are installed.');
}
