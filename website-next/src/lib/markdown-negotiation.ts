/**
 * Whether a request for a page with a Markdown twin should get the Markdown.
 *
 * Explicit asks always win: a `.md` suffix or `Accept: text/markdown`. Beyond
 * that, known agents and HTTP libraries get Markdown by user agent, but a real
 * browser never does, even when its user agent names an AI product (the Claude
 * desktop app, Cursor and others embed Chromium with their name in the UA).
 */
const AGENT_UA = /(claude|chatgpt|gptbot|openai|anthropic|cursor|copilot|perplexity|axios|got\/|node-fetch|undici|python-requests|httpx)/i;

/** A browser engine token, and no crawler marker (ClaudeBot, GPTBot and friends say "compatible;" or "bot"). */
function isBrowser(userAgent: string, secFetchMode: string | null): boolean {
  if (/bot\b|bot\/|compatible;/i.test(userAgent)) return false;
  // Only browsers send Fetch Metadata headers.
  if (secFetchMode) return true;
  return /\b(Chrome|Firefox|Safari)\/\d/.test(userAgent);
}

export function wantsMarkdown(input: { pathname: string; accept: string | null; userAgent: string | null; secFetchMode: string | null }): boolean {
  if (input.pathname.endsWith('.md')) return true;
  if ((input.accept ?? '').includes('text/markdown')) return true;
  const userAgent = input.userAgent ?? '';
  return AGENT_UA.test(userAgent) && !isBrowser(userAgent, input.secFetchMode);
}
