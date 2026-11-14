import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToMarkdown } from './html-to-markdown';

const base = new URL('https://hypequery.com/embedded-analytics');

function page(main: string, head = ''): string {
  return `<!DOCTYPE html><html><head><title>Page title | hypequery</title><meta name="description" content="Page description.">${head}</head>
<body><header><nav><a href="/docs">Docs</a></nav></header><main>${main}</main><footer>Footer text</footer></body></html>`;
}

test('reads title and description from the head', () => {
  const result = htmlToMarkdown(page('<h1>Hello</h1>'), base);
  assert.equal(result.title, 'Page title | hypequery');
  assert.equal(result.description, 'Page description.');
});

test('keeps only <main>, dropping header, footer, nav and interactive chrome', () => {
  const { markdown } = htmlToMarkdown(
    page('<nav><a href="/x">In-page nav</a></nav><h1>Hello</h1><p>Body text.</p><button>Copy</button><script>alert(1)</script><svg><text>icon</text></svg><form><input></form>'),
    base,
  );
  assert.match(markdown, /^# Hello/m);
  assert.match(markdown, /Body text\./);
  for (const absent of ['Docs', 'Footer text', 'In-page nav', 'Copy', 'alert', 'icon']) assert.ok(!markdown.includes(absent), absent);
});

test('drops hidden content, React comments and empty links', () => {
  const { markdown } = htmlToMarkdown(
    page('<p>Seen<!-- -->text</p><div hidden>Hidden</div><span aria-hidden="true">Decor</span><a href="#top"> </a>'),
    base,
  );
  assert.match(markdown, /Seentext/);
  for (const absent of ['Hidden', 'Decor', '<!--', '[ ]', '#top']) assert.ok(!markdown.includes(absent), absent);
});

test('resolves relative links and images against the page URL, keeping fragments', () => {
  const { markdown } = htmlToMarkdown(
    page('<p><a href="/docs/quick-start">Quick start</a> <a href="pricing">Pricing</a> <a href="#vendors">Vendors</a> <a href="https://github.com/hypequery/hypequery">GitHub</a></p><img src="/logo.png" alt="Logo">'),
    base,
  );
  assert.match(markdown, /\[Quick start\]\(https:\/\/hypequery\.com\/docs\/quick-start\)/);
  assert.match(markdown, /\[Pricing\]\(https:\/\/hypequery\.com\/pricing\)/);
  assert.match(markdown, /\[Vendors\]\(#vendors\)/);
  assert.match(markdown, /\[GitHub\]\(https:\/\/github\.com\/hypequery\/hypequery\)/);
  assert.match(markdown, /!\[Logo\]\(https:\/\/hypequery\.com\/logo\.png\)/);
});

test('converts code blocks and tables', () => {
  const { markdown } = htmlToMarkdown(
    page('<pre><code class="language-ts">const x = 1;\nconst y = 2;</code></pre><table><thead><tr><th>Tool</th><th>License</th></tr></thead><tbody><tr><td>hypequery</td><td>Apache 2.0</td></tr></tbody></table>'),
    base,
  );
  assert.match(markdown, /```ts\nconst x = 1;\nconst y = 2;\n```/);
  assert.match(markdown, /\| Tool +\| License +\|/);
  assert.match(markdown, /\| hypequery +\| Apache 2\.0 +\|/);
});

test('falls back to <body> when a page has no <main>', () => {
  const { markdown } = htmlToMarkdown('<html><body><h1>No main</h1></body></html>', base);
  assert.match(markdown, /^# No main/m);
});
