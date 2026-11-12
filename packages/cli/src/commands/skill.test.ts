import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_SKILLS } from '../templates/skills.generated.js';
import { skillCommand } from './skill.js';

vi.mock('../utils/logger.js', () => ({ logger: { success: vi.fn(), error: vi.fn() } }));

const temporary: string[] = [];
async function directory(): Promise<string> {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-skill-')));
  temporary.push(created);
  return created;
}
afterEach(async () => {
  process.exitCode = 0;
  await Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true })));
});

const names = AGENT_SKILLS.map(skill => skill.name);

describe('hypequery skill install', () => {
  it('embeds every skill in the repository, unchanged', async () => {
    const root = new URL('../../../../skills/', import.meta.url);
    const onDisk = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(names).toEqual(onDisk);
    for (const skill of AGENT_SKILLS) {
      // Run `node scripts/generate-skills.mjs` after editing skills/.
      expect(skill.content).toBe(await readFile(new URL(`${skill.name}/SKILL.md`, root), 'utf8'));
      expect(skill.content).toMatch(new RegExp(`^---\\nname: ${skill.name}\\ndescription: .{40,1024}\\n---\\n`));
    }
  });

  it.each([
    ['claude', ['.claude/skills']],
    ['cursor', ['.agents/skills']],
    ['codex', ['.agents/skills']],
    ['all', ['.claude/skills', '.agents/skills']],
  ])('installs for %s where that agent loads skills', async (agent, roots) => {
    const cwd = await directory();
    await skillCommand('install', { agent }, { cwd });
    for (const root of roots) {
      for (const skill of AGENT_SKILLS) {
        expect(await readFile(path.join(cwd, root, skill.name, 'SKILL.md'), 'utf8')).toBe(skill.content);
      }
    }
    const installed = await readdir(cwd);
    expect(installed.sort()).toEqual([...new Set(roots.map(root => root.split('/')[0]))].sort());
  });

  it('is idempotent, and --check passes after an install', async () => {
    const cwd = await directory();
    await skillCommand('install', {}, { cwd });
    await skillCommand('install', {}, { cwd });
    await skillCommand('install', { check: true }, { cwd });
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('--check exits 1 when a skill is missing or edited, without writing', async () => {
    const cwd = await directory();
    await expect(skillCommand('install', { check: true, agent: 'claude' }, { cwd }))
      .rejects.toMatchObject({ code: 'OUT_OF_DATE', exitCode: 1 });
    expect(await readdir(cwd)).toEqual([]);
  });

  it('refuses to overwrite an edited skill unless forced', async () => {
    const cwd = await directory();
    await skillCommand('install', { agent: 'claude' }, { cwd });
    const file = path.join(cwd, '.claude/skills', names[0], 'SKILL.md');
    await writeFile(file, 'my own notes');
    await expect(skillCommand('install', { agent: 'claude' }, { cwd })).rejects.toThrow('--force');
    expect(await readFile(file, 'utf8')).toBe('my own notes');
    await skillCommand('install', { agent: 'claude', force: true }, { cwd });
    expect(await readFile(file, 'utf8')).toBe(AGENT_SKILLS[0].content);
  });

  it('installs into the home directory with --scope user', async () => {
    const cwd = await directory();
    const home = await directory();
    await skillCommand('install', { scope: 'user', agent: 'codex' }, { cwd, home });
    expect(await readdir(cwd)).toEqual([]);
    expect(await readdir(path.join(home, '.agents/skills'))).toEqual([...names].sort());
  });

  it.each([
    [undefined, {}, 'Usage: hypequery skill install'],
    ['remove', {}, 'Usage: hypequery skill install'],
    ['install', { agent: 'vim' }, 'Unknown --agent vim'],
    ['install', { scope: 'global' }, 'Unknown --scope global'],
    ['install', { check: true, force: true }, '--force cannot be combined'],
  ])('rejects %s %o', async (action, options, message) => {
    await expect(skillCommand(action, options, { cwd: await directory() })).rejects.toThrow(message);
  });
});
