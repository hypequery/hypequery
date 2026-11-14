import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
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

  it('connects to the hypequery app over remote HTTP MCP, overridable by environment', async () => {
    const config = await json(new URL('.mcp.json', plugin));
    expect(config).toEqual({
      mcpServers: {
        hypequery: { type: 'http', url: '${HYPEQUERY_APP_MCP_URL:-https://mcp.hypequery.com/mcp}' },
      },
    });
  });

  it('bundles every skill in skills/, unchanged', async () => {
    const bundled = (await readdir(new URL('skills/', plugin), { withFileTypes: true }))
      .map(entry => entry.name)
      .sort();
    expect(bundled).toEqual(AGENT_SKILLS.map(skill => skill.name));
    for (const skill of AGENT_SKILLS) {
      // Run `node packages/cli/scripts/generate-skills.mjs` after editing skills/.
      expect(await readFile(new URL(`skills/${skill.name}/SKILL.md`, plugin), 'utf8')).toBe(skill.content);
    }
  });

  it('passes the generator drift check', async () => {
    const script = new URL('packages/cli/scripts/generate-skills.mjs', repository);
    await expect(promisify(execFile)(process.execPath, [fileURLToPath(script), '--check'])).resolves.toBeDefined();
  });
});
