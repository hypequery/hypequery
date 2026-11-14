import { describe, expect, it } from 'vitest';
import { buildSlackManifest } from './manifest.js';

describe('buildSlackManifest', () => {
  it('builds an HTTP manifest with the minimal scopes and events', () => {
    const manifest = buildSlackManifest({ name: 'Acme data', requestUrl: 'https://bot.acme.com/slack/events' }) as any;
    expect(manifest.oauth_config.scopes.bot).toEqual([
      'app_mentions:read',
      'assistant:write',
      'chat:write',
      'im:history',
      'im:read',
      'im:write',
    ]);
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: 'https://bot.acme.com/slack/events',
      bot_events: ['app_mention', 'app_uninstalled', 'assistant_thread_started', 'message.im', 'tokens_revoked'],
    });
    expect(manifest.settings.interactivity).toEqual({ is_enabled: true, request_url: 'https://bot.acme.com/slack/events' });
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.features.bot_user.display_name).toBe('Acme data');
  });

  it('builds a Socket Mode manifest without request URLs', () => {
    const manifest = buildSlackManifest({ socketMode: true }) as any;
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.settings.event_subscriptions.request_url).toBeUndefined();
    expect(manifest.settings.interactivity).toEqual({ is_enabled: true });
  });

  it('adds channel history scopes only when asked', () => {
    const manifest = buildSlackManifest({ socketMode: true, channelThreadHistory: true }) as any;
    expect(manifest.oauth_config.scopes.bot).toContain('channels:history');
    expect(manifest.oauth_config.scopes.bot).toContain('groups:history');
  });

  it('includes up to four suggested prompts', () => {
    const prompts = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, message: `M${i}` }));
    const manifest = buildSlackManifest({ socketMode: true, suggestedPrompts: prompts }) as any;
    expect(manifest.features.assistant_view.suggested_prompts).toHaveLength(4);
  });

  it('rejects bad input', () => {
    expect(() => buildSlackManifest()).toThrow(/requestUrl is required/);
    expect(() => buildSlackManifest({ requestUrl: 'http://bot.acme.com' })).toThrow(/https/);
    expect(() => buildSlackManifest({ socketMode: true, name: 'x'.repeat(36) })).toThrow(/name/);
  });
});
