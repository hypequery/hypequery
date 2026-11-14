/**
 * A Slack app manifest for a hypequery analytics bot: the scopes, events and
 * settings `createSlackBot()` needs, and nothing more. Paste it into
 * https://api.slack.com/apps?new_app=1 ("From a manifest").
 *
 * https://api.slack.com/reference/manifests
 */

import type { SlackSuggestedPrompt } from './api.js';

export interface SlackManifestOptions {
  /** App and bot name. At most 35 characters. @default 'hypequery' */
  name?: string;
  /** At most 140 characters. */
  description?: string;
  /**
   * Public https URL of your `createSlackRequestHandler` route, for Events and
   * Interactivity. Leave it out with `socketMode: true`.
   */
  requestUrl?: string;
  /** Receive events over Socket Mode instead of a Request URL. @default false */
  socketMode?: boolean;
  /**
   * Read earlier messages in channel threads, so follow-ups have context.
   * Adds `channels:history` and `groups:history`, which let the bot read every
   * message in channels it has been added to. DM threads never need it.
   * @default false
   */
  channelThreadHistory?: boolean;
  /** Prompts the assistant pane shows before the first message. At most 4. */
  suggestedPrompts?: SlackSuggestedPrompt[];
}

export const SLACK_BOT_SCOPES = ['app_mentions:read', 'assistant:write', 'chat:write', 'im:history', 'im:read', 'im:write'] as const;
export const SLACK_THREAD_HISTORY_SCOPES = ['channels:history', 'groups:history'] as const;
export const SLACK_BOT_EVENTS = ['app_mention', 'app_uninstalled', 'assistant_thread_started', 'message.im', 'tokens_revoked'] as const;

export function buildSlackManifest(options: SlackManifestOptions = {}): Record<string, unknown> {
  const name = (options.name ?? 'hypequery').trim();
  if (!name || name.length > 35) throw new TypeError('buildSlackManifest: name must be 1 to 35 characters');
  const description = options.description ?? 'Answers questions about your data from governed hypequery datasets.';
  if (description.length > 140) throw new TypeError('buildSlackManifest: description must be at most 140 characters');

  const socketMode = options.socketMode ?? false;
  if (!socketMode) {
    if (!options.requestUrl) throw new TypeError('buildSlackManifest: requestUrl is required unless socketMode is true');
    if (!isHttpsUrl(options.requestUrl)) throw new TypeError('buildSlackManifest: requestUrl must be an https URL');
  }
  const requestUrl = socketMode ? {} : { request_url: options.requestUrl };

  const scopes = [...SLACK_BOT_SCOPES, ...(options.channelThreadHistory ? SLACK_THREAD_HISTORY_SCOPES : [])].sort();

  return {
    _metadata: { major_version: 2, minor_version: 1 },
    display_information: { name, description, background_color: '#111827' },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: name, always_online: true },
      assistant_view: {
        assistant_description: description,
        ...(options.suggestedPrompts?.length
          ? { suggested_prompts: options.suggestedPrompts.slice(0, 4) }
          : {}),
      },
    },
    oauth_config: { scopes: { bot: scopes } },
    settings: {
      event_subscriptions: { ...requestUrl, bot_events: [...SLACK_BOT_EVENTS] },
      // The "Open in hypequery" button is a link button; Slack still sends it to Interactivity.
      interactivity: { is_enabled: true, ...requestUrl },
      org_deploy_enabled: false,
      socket_mode_enabled: socketMode,
      token_rotation_enabled: false,
    },
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
