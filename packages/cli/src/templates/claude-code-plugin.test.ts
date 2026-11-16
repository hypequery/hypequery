import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_SKILLS } from './skills.generated.js';

// The Claude Code plugin in plugins/claude-code/hypequery/ and the marketplace
// file that serves it from this repository. Its skills are copies of skills/,
// written by scripts/generate-skills.mjs; `claude plugin validate` is the
// authoritative manifest check (see the plugin README).
const repository = new URL('../../../../', import.meta.url);
const plugin = new URL('plugins/claude-code/hypequery/', repository);

async function json(url: URL): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(url, 'utf8')) as Record<string, unknown>;
}

describe('the Claude Code plugin', () => {
  it('has a manifest that parses, named hypequery', async () => {
    const manifest = await json(new URL('.claude-plugin/plugin.json', plugin));
    expect(manifest).toMatchObject({ name: 'hypequery', license: 'Apache-2.0' });
    expect(manifest.description).toEqual(expect.any(String));
    // Left out on purpose: without it, installs track the repository's commits.
    expect(manifest).not.toHaveProperty('version');
  });

  it('is listed in the repository marketplace under the same name', async () => {
    const marketplace = await json(new URL('.claude-plugin/marketplace.json', repository));
    expect(marketplace).toMatchObject({ name: 'hypequery', owner: { name: 'hypequery' } });
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: 'hypequery', source: './plugins/claude-code/hypequery' }),
    ]);
  });

  it('connects to the hypequery app over remote HTTP MCP, at a fixed URL', async () => {
    const config = await json(new URL('.mcp.json', plugin));
    expect(config).toEqual({
      mcpServers: {
        hypequery: { type: 'http', url: 'https://mcp.hypequery.com/mcp' },
      },
    });
    // No `${VAR}` expansion: the environment can't redirect sign-in and tool calls.
    expect(JSON.stringify(config)).not.toContain('${');
  });

  it('bundles every skill in skills/, unchanged', async () => {
    const bundled = (await readdir(new URL('skills/', plugin), { withFileTypes: true }))
      .map(entry => entry.name)
      .filter(name => !name.startsWith('.'))
      .sort();
    expect(bundled).toEqual(AGENT_SKILLS.map(skill => skill.name));
    for (const skill of AGENT_SKILLS) {
      // Run `node packages/cli/scripts/generate-skills.mjs` after editing skills/.
      expect(await readFile(new URL(`skills/${skill.name}/SKILL.md`, plugin), 'utf8')).toBe(skill.content);
    }
  });

  it('ignores dotfiles such as .DS_Store: not drift, and never deleted', async () => {
    // A scratch copy of the generator's inputs and outputs, so the real tree is untouched.
    const scratch = await mkdtemp(path.join(tmpdir(), 'hq-skills-'));
    try {
      const at = (relative: string) => path.join(scratch, relative);
      await cp(fileURLToPath(new URL('skills/', repository)), at('skills'), { recursive: true });
      await cp(fileURLToPath(new URL('skills/', plugin)), at('plugins/claude-code/hypequery/skills'), { recursive: true });
      await cp(fileURLToPath(new URL('packages/cli/scripts/generate-skills.mjs', repository)), at('packages/cli/scripts/generate-skills.mjs'));
      await cp(fileURLToPath(new URL('packages/cli/src/templates/skills.generated.ts', repository)), at('packages/cli/src/templates/skills.generated.ts'));
      for (const stray of ['skills/.DS_Store', 'plugins/claude-code/hypequery/skills/.DS_Store']) await writeFile(at(stray), 'x');
      const script = at('packages/cli/scripts/generate-skills.mjs');
      const run = (args: string[]) => promisify(execFile)(process.execPath, [script, ...args]);
      await expect(run(['--check'])).resolves.toBeDefined();
      await run([]);
      expect(await readFile(at('plugins/claude-code/hypequery/skills/.DS_Store'), 'utf8')).toBe('x');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  describe('the generator refuses unsafe inputs', () => {
    /** A scratch copy of the generator's inputs and outputs, so the real tree is untouched. */
    async function scratchRepository() {
      const scratch = await mkdtemp(path.join(tmpdir(), 'hq-skills-'));
      const at = (relative: string) => path.join(scratch, relative);
      await cp(fileURLToPath(new URL('skills/', repository)), at('skills'), { recursive: true });
      await cp(fileURLToPath(new URL('skills/', plugin)), at('plugins/claude-code/hypequery/skills'), { recursive: true });
      await cp(fileURLToPath(new URL('packages/cli/scripts/generate-skills.mjs', repository)), at('packages/cli/scripts/generate-skills.mjs'));
      await cp(fileURLToPath(new URL('packages/cli/src/templates/skills.generated.ts', repository)), at('packages/cli/src/templates/skills.generated.ts'));
      const run = (args: string[]) => promisify(execFile)(process.execPath, [at('packages/cli/scripts/generate-skills.mjs'), ...args]);
      return { scratch, at, run };
    }
    const scratches: string[] = [];
    afterEach(async () => {
      await Promise.all(scratches.splice(0).map(item => rm(item, { recursive: true, force: true })));
    });

    it.each(['Bad_Name', 'with space', '-leading'])('fails on a skill directory named %j', async (name) => {
      const { scratch, at, run } = await scratchRepository();
      scratches.push(scratch);
      await mkdir(at(`skills/${name}`));
      await writeFile(at(`skills/${name}/SKILL.md`), 'x');
      for (const args of [['--check'], []]) {
        await expect(run(args)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('must match') });
      }
      await expect(readdir(at('plugins/claude-code/hypequery/skills'))).resolves.not.toContain(name);
    });

    it('refuses a symlinked plugin skill directory, and writes nothing through it', async () => {
      const { scratch, at, run } = await scratchRepository();
      scratches.push(scratch);
      const outside = await mkdtemp(path.join(tmpdir(), 'hq-outside-'));
      scratches.push(outside);
      await writeFile(path.join(outside, 'SKILL.md'), 'outside');
      const linked = at('plugins/claude-code/hypequery/skills/hypequery-query');
      await rm(linked, { recursive: true });
      await symlink(outside, linked, 'dir');
      await expect(run([])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('symbolic link') });
      expect(await readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe('outside');
    });

    it('refuses a stale plugin skill that is a symlink, rather than deleting through it', async () => {
      const { scratch, at, run } = await scratchRepository();
      scratches.push(scratch);
      const outside = await mkdtemp(path.join(tmpdir(), 'hq-outside-'));
      scratches.push(outside);
      await writeFile(path.join(outside, 'keep.txt'), 'keep');
      await symlink(outside, at('plugins/claude-code/hypequery/skills/old-skill'), 'dir');
      await expect(run([])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('symbolic link') });
      expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    });

    it('refuses a symlinked SKILL.md source', async () => {
      const { scratch, at, run } = await scratchRepository();
      scratches.push(scratch);
      const outside = await mkdtemp(path.join(tmpdir(), 'hq-outside-'));
      scratches.push(outside);
      await writeFile(path.join(outside, 'secret'), 'not a skill');
      await rm(at('skills/hypequery-query/SKILL.md'));
      await symlink(path.join(outside, 'secret'), at('skills/hypequery-query/SKILL.md'));
      await expect(run(['--check'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('symbolic link') });
    });
  });

  it('passes the generator drift check', async () => {
    const script = new URL('packages/cli/scripts/generate-skills.mjs', repository);
    await expect(promisify(execFile)(process.execPath, [fileURLToPath(script), '--check'])).resolves.toBeDefined();
  });
});
