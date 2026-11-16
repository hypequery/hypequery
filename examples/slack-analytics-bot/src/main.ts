import { createServer } from 'node:http';
import { createSlackClient, createSlackRequestHandler, createSocketModeClient } from '@hypequery/slack';
import { serveFetch } from '../lib/utils/node-http.js';
import { createBot } from './bot.js';

const botToken = process.env.SLACK_BOT_TOKEN;
if (!botToken) throw new Error('Set SLACK_BOT_TOKEN (OAuth & Permissions → Bot User OAuth Token).');

const bot = createBot(createSlackClient({ token: botToken }));

if (process.env.SLACK_APP_TOKEN) {
  // Socket Mode: no public URL; good for a laptop or a server behind a firewall.
  const socket = createSocketModeClient({ appToken: process.env.SLACK_APP_TOKEN, onEvent: bot.onEvent });
  await socket.start();
  console.log('Connected to Slack over Socket Mode.');
} else {
  // Events API over HTTP: point the app's Request URL at https://<your host>/slack/events.
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) throw new Error('Set SLACK_APP_TOKEN for Socket Mode, or SLACK_SIGNING_SECRET for HTTP.');
  const handle = createSlackRequestHandler({ signingSecret, onEvent: bot.onEvent });
  const port = Number(process.env.PORT ?? 3000);
  createServer(serveFetch(handle, { path: '/slack/events', origin: `http://localhost:${port}` }))
    .listen(port, () => console.log(`Listening on http://localhost:${port}/slack/events`));
}
