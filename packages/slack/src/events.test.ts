import { describe, expect, it } from 'vitest';
import { normalizeSlackEvent, parseSlackBody, stripBotMention } from './events.js';
import { BOT, envelope } from './fixtures.test-utils.js';

describe('parseSlackBody', () => {
  it('reads url_verification', () => {
    expect(parseSlackBody(JSON.stringify({ type: 'url_verification', challenge: 'abc' }), 'application/json')).toEqual({
      type: 'url_verification',
      challenge: 'abc',
    });
  });

  it('reads an event callback', () => {
    const body = parseSlackBody(JSON.stringify(envelope({ type: 'app_mention' })), 'application/json');
    expect(body.type).toBe('event');
  });

  it('reads interactions and slash commands from form bodies', () => {
    const form = 'application/x-www-form-urlencoded';
    expect(parseSlackBody(`payload=${encodeURIComponent('{"type":"block_actions"}')}`, form)).toEqual({
      type: 'interaction',
      payload: { type: 'block_actions' },
    });
    const command = parseSlackBody('command=%2Fask&text=revenue&user_id=U1', form);
    expect(command).toMatchObject({ type: 'command', command: { command: '/ask', text: 'revenue', user_id: 'U1' } });
  });

  it('never throws on garbage', () => {
    expect(parseSlackBody('{not json', 'application/json')).toEqual({ type: 'unknown' });
    expect(parseSlackBody('payload=%7Bbad', 'application/x-www-form-urlencoded')).toEqual({ type: 'unknown' });
    expect(parseSlackBody('[]', 'application/json')).toEqual({ type: 'unknown' });
  });
});

describe('normalizeSlackEvent', () => {
  it('turns an app_mention into a question with the mention removed', () => {
    const event = normalizeSlackEvent(
      envelope({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '10.1', text: `<@${BOT}>  revenue by   region?` }),
    );
    expect(event).toMatchObject({
      kind: 'question',
      source: 'mention',
      teamId: 'T1',
      botUserId: BOT,
      userId: 'U1',
      channelId: 'C1',
      text: 'revenue by region?',
      threadTs: '10.1',
      inThread: false,
      isExtSharedChannel: false,
    });
  });

  it('replies in the parent thread when mentioned inside one', () => {
    const event = normalizeSlackEvent(
      envelope({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '12.0', thread_ts: '10.1', text: `<@${BOT}> and EU?` }),
    );
    expect(event).toMatchObject({ kind: 'question', threadTs: '10.1', inThread: true });
  });

  it('accepts DMs and ignores non-DM message events', () => {
    const dm = normalizeSlackEvent(envelope({ type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '1.0', text: 'hi' }));
    expect(dm).toMatchObject({ kind: 'question', source: 'dm', channelId: 'D1' });
    const channel = normalizeSlackEvent(envelope({ type: 'message', channel_type: 'channel', user: 'U1', channel: 'C1', ts: '1.0' }));
    expect(channel).toMatchObject({ kind: 'ignored', reason: 'message_not_in_dm' });
  });

  it('ignores bots, itself, edits and incomplete events', () => {
    const base = { type: 'message', channel_type: 'im', channel: 'D1', ts: '1.0', text: 'x' };
    expect(normalizeSlackEvent(envelope({ ...base, user: 'U1', bot_id: 'B1' }))).toMatchObject({ reason: 'from_bot' });
    expect(normalizeSlackEvent(envelope({ ...base, user: BOT }))).toMatchObject({ reason: 'from_self' });
    expect(normalizeSlackEvent(envelope({ ...base, user: 'U1', subtype: 'message_changed' }))).toMatchObject({
      reason: 'subtype_message_changed',
    });
    expect(normalizeSlackEvent(envelope({ ...base }))).toMatchObject({ reason: 'missing_fields' });
  });

  it('flags Slack Connect channels', () => {
    const event = normalizeSlackEvent(
      envelope({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '1.0', text: 'x' }, { is_ext_shared_channel: true }),
    );
    expect(event).toMatchObject({ isExtSharedChannel: true });
  });

  it('reads assistant threads, uninstalls and token revocations', () => {
    expect(
      normalizeSlackEvent(
        envelope({
          type: 'assistant_thread_started',
          assistant_thread: { user_id: 'U1', channel_id: 'D1', thread_ts: '5.0', context: { channel_id: 'C9' } },
        }),
      ),
    ).toMatchObject({ kind: 'assistant_thread_started', userId: 'U1', channelId: 'D1', threadTs: '5.0', contextChannelId: 'C9' });
    expect(normalizeSlackEvent(envelope({ type: 'app_uninstalled' }))).toMatchObject({ kind: 'app_uninstalled', teamId: 'T1' });
    expect(normalizeSlackEvent(envelope({ type: 'tokens_revoked', tokens: { bot: [BOT] } }))).toMatchObject({
      kind: 'tokens_revoked',
      botUserIds: [BOT],
      userIds: [],
    });
  });

  it('reads enterprise ids from the envelope or authorizations', () => {
    const event = normalizeSlackEvent(
      envelope({ type: 'app_uninstalled' }, { authorizations: [{ enterprise_id: 'E1', team_id: 'T1', user_id: BOT, is_bot: true }] }),
    );
    expect(event.enterpriseId).toBe('E1');
  });
});

describe('stripBotMention', () => {
  it('removes only the bot mention and keeps other users', () => {
    expect(stripBotMention(`<@${BOT}> ask <@U2> about it <@${BOT}|bot>`, BOT)).toBe('ask <@U2> about it');
  });
  it('removes a leading mention when the bot id is unknown', () => {
    expect(stripBotMention('<@UX> hello <@U2>', null)).toBe('hello <@U2>');
  });
});
