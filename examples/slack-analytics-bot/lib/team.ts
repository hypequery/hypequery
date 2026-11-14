import { channelCeiling, type SlackAccessDecision, type SlackAskContext } from '@hypequery/slack';

/**
 * Who on your team may ask what, and where. Roles are ordered: an admin can
 * see everything an analyst can, plus revenue.
 *
 * - People: SLACK_MEMBERS="U0123:admin,U0456:analyst". Anyone not listed gets no answer.
 * - Channels: SLACK_CHANNELS="C0PRODUCT:analyst,C0LEADERS:admin". Each channel's role
 *   is its ceiling: what may be posted where everyone in it can read. Unlisted
 *   channels get no answer. DMs need no entry.
 *
 * Replace the env parsing with your own directory (SSO groups, a database)
 * when you outgrow it. Access is decided here, never from message text.
 */
export const ROLES = ['analyst', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface Member {
  slackUserId: string;
  role: Role;
}

export function parseRoles(value: string | undefined): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const entry of (value ?? '').split(',').map(part => part.trim()).filter(Boolean)) {
    const [id, role] = entry.split(':').map(part => part.trim());
    if (!id || !(ROLES as readonly string[]).includes(role ?? '')) {
      throw new Error(`Bad entry "${entry}": use <slack id>:${ROLES.join('|')}`);
    }
    roles.set(id, role as Role);
  }
  return roles;
}

export function createTeamAccess(config: { members: Map<string, Role>; channels: Map<string, Role> }) {
  return function resolveAccess(context: SlackAskContext): SlackAccessDecision<Member> {
    const role = config.members.get(context.userId);
    if (!role) {
      return { allow: false, message: "You're not set up to ask me questions yet.", hint: 'Ask an admin to add you to SLACK_MEMBERS.' };
    }
    return channelCeiling({
      access: { slackUserId: context.userId, role },
      ceiling: config.channels.get(context.channelId) ?? null,
      source: context.source,
      fits: (ceiling, member) => ROLES.indexOf(member.role) <= ROLES.indexOf(ceiling),
      notConnectedMessage: "I don't answer in this channel yet. Ask me in a DM, or ask an admin to add it to SLACK_CHANNELS.",
    });
  };
}
