import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wantsMarkdown } from './markdown-negotiation';

const page = '/recipes/p95-latency';
const ask = (userAgent: string | null, extra: { accept?: string; secFetchMode?: string; pathname?: string } = {}) =>
  wantsMarkdown({ pathname: extra.pathname ?? page, accept: extra.accept ?? null, userAgent, secFetchMode: extra.secFetchMode ?? null });

test('browsers get HTML, even when the UA names an AI app', () => {
  const claudeDesktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/4.4212.0 Chrome/152.0.7977.167 Safari/537.36';
  assert.equal(ask(claudeDesktop, { secFetchMode: 'navigate', accept: 'text/html,application/xhtml+xml' }), false);
  assert.equal(ask(claudeDesktop), false);
  assert.equal(ask('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/1.4.2 Chrome/138.0.0.0 Electron/37.2.3 Safari/537.36'), false);
  assert.equal(ask('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0'), false);
});

test('agents and HTTP libraries get Markdown', () => {
  assert.equal(ask('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'), true);
  assert.equal(ask('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'), true);
  assert.equal(ask('Claude-User/1.0'), true);
  assert.equal(ask('python-requests/2.32.3'), true);
  assert.equal(ask('node-fetch'), true);
});

test('explicit asks win for anyone', () => {
  assert.equal(ask('Mozilla/5.0 Chrome/152.0 Safari/537.36', { accept: 'text/markdown' }), true);
  assert.equal(ask('Mozilla/5.0 Chrome/152.0 Safari/537.36', { pathname: `${page}.md`, secFetchMode: 'navigate' }), true);
});

test('unknown clients get HTML', () => {
  assert.equal(ask(null), false);
  assert.equal(ask('curl/8.7.1'), false);
});
