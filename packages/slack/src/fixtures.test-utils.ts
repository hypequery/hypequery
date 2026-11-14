import type { SlackEventEnvelope, SlackRawEvent } from './events.js';

export const BOT = 'UBOT';

export function envelope(event: SlackRawEvent, overrides: Partial<SlackEventEnvelope> = {}): SlackEventEnvelope {
  return {
    type: 'event_callback',
    team_id: 'T1',
    api_app_id: 'A1',
    event_id: 'Ev1',
    event_time: 1,
    authorizations: [{ team_id: 'T1', enterprise_id: null, user_id: BOT, is_bot: true }],
    event,
    ...overrides,
  };
}
