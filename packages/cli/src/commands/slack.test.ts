import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slackCommand } from './slack.js';

vi.mock('../utils/logger.js', () => ({
  logger: { success: vi.fn(), error: vi.fn(), info: vi.fn(), indent: vi.fn(), newline: vi.fn() },
}));

const temporary: string[] = [];
async function directory(): Promise<string> {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-slack-')));
  temporary.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true })));
});

const read = async (cwd: string, file = 'slack-app-manifest.json') => JSON.parse(await readFile(path.join(cwd, file), 'utf8'));

describe('hypequery slack init', () => {
  it('writes an HTTP manifest with the request URL', async () => {
    const cwd = await directory();
    await slackCommand('init', { url: 'https://bot.acme.com/slack/events', name: 'Acme data' }, { cwd });
    const manifest = await read(cwd);
    expect(manifest.display_information.name).toBe('Acme data');
    expect(manifest.settings.event_subscriptions.request_url).toBe('https://bot.acme.com/slack/events');
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.oauth_config.scopes.bot).not.toContain('channels:history');
  });

  it('writes a Socket Mode manifest, with thread history when asked, to --output', async () => {
    const cwd = await directory();
    await slackCommand('init', { socket: true, threadHistory: true, output: 'slack/manifest.json' }, { cwd });
    const manifest = await read(cwd, 'slack/manifest.json');
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.oauth_config.scopes.bot).toContain('channels:history');
  });

  it('is idempotent and refuses to overwrite an edited manifest without --force', async () => {
    const cwd = await directory();
    await slackCommand('init', { socket: true }, { cwd });
    await slackCommand('init', { socket: true }, { cwd });
    await writeFile(path.join(cwd, 'slack-app-manifest.json'), '{"edited":true}\n');
    await expect(slackCommand('init', { socket: true }, { cwd })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    await slackCommand('init', { socket: true, force: true }, { cwd });
    expect((await read(cwd)).settings.socket_mode_enabled).toBe(true);
  });

  it('rejects bad usage', async () => {
    const cwd = await directory();
    await expect(slackCommand(undefined, { socket: true }, { cwd })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(slackCommand('init', {}, { cwd })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(slackCommand('init', { socket: true, url: 'https://x.dev' }, { cwd })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(slackCommand('init', { url: 'http://insecure.dev' }, { cwd })).rejects.toMatchObject({
      code: 'USAGE',
      message: 'requestUrl must be an https URL',
    });
  });
});
