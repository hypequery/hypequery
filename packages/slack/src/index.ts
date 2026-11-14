/**
 * @hypequery/slack
 *
 * Slack transport and Block Kit rendering for hypequery analytics agents.
 * No runtime dependencies: Web Crypto for signatures and `fetch` for the Web
 * API, so it runs on Node.js 20+, Deno, Bun, Workers and Vercel Edge.
 *
 * - `createSlackRequestHandler()`: a Fetch API handler for the Events API,
 *   interactivity and slash commands (verify, ack at once, run afterwards).
 * - `createSocketModeClient()`: the same handlers over Socket Mode, with no
 *   public URL.
 * - `createSlackClient()`: the Web API methods a bot needs.
 * - `renderSlackAnswer()`: an answer, table and source as Block Kit.
 * - `createSlackBot()`: the question → answer flow, with channel-ceiling
 *   access, thread history and private replies; `answerFromToolResults()`
 *   turns an agent run into an answer with its table and source.
 */

export * from './verify.js';
export * from './events.js';
export * from './dispatch.js';
export * from './http.js';
export * from './socket.js';
export * from './api.js';
export * from './blocks.js';
export * from './bot.js';
export * from './utils/history.js';
export * from './utils/tool-steps.js';
