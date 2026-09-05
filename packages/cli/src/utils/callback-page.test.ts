import { describe, expect, it } from 'vitest';

import { callbackHtml } from './callback-page.js';

describe('Cloud CLI callback page', () => {
  it('tells a successful user the CLI is authorized and the tab can be closed', () => {
    const html = callbackHtml(true);

    expect(html).toContain('<title>CLI authorized · hypequery</title>');
    expect(html).toContain('>Connected<');
    expect(html).toContain('hypequery CLI is authorized');
    expect(html).toContain(
      'You can close this window and return to your terminal.',
    );
    expect(html).toContain('Safe to close this tab');
  });

  it('tells a failed user to retry the login command', () => {
    const html = callbackHtml(false);

    expect(html).toContain('<title>Authorization failed · hypequery</title>');
    expect(html).toContain('>Failed<');
    expect(html).toContain(
      'Return to your terminal and run the login command again.',
    );
    expect(html).not.toContain('Safe to close this tab');
  });

  it('never shows success wording on the failure page', () => {
    const html = callbackHtml(false);

    expect(html).not.toContain('Connected');
    expect(html).not.toContain('authorized');
  });

  it('resolves the status colour tokens it interpolates', () => {
    // The status chip builds `var(--ok)`/`var(--bad)` from the state, so a
    // renamed token would silently fall back to an unstyled chip.
    for (const [success, token] of [[true, 'ok'], [false, 'bad']] as const) {
      const html = callbackHtml(success);
      expect(html).toContain(`color:var(--${token});background:var(--${token}-soft)`);
      expect(html).toContain(`--${token}:`);
      expect(html).toContain(`--${token}-soft:`);
    }
  });

  it('stays self-contained so the strict callback CSP can render it', () => {
    // The listener serves this under `default-src 'none'; style-src
    // 'unsafe-inline'`, so any external or scripted resource would be blocked.
    for (const success of [true, false]) {
      const html = callbackHtml(success);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/\b(?:src|href)=/i);
      expect(html).not.toMatch(/url\(/i);
      expect(html).not.toMatch(/https?:\/\//i);
    }
  });

  it('declares the document shell both pages depend on', () => {
    for (const success of [true, false]) {
      const html = callbackHtml(success);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
      );
      expect(html).toContain('color-scheme:light dark');
      expect(html).toContain('@media (prefers-color-scheme:dark)');
    }
  });
});
