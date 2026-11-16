import { describe, expect, it } from 'vitest';
import { parseCloudErrorBody } from './cloud-error-body.js';
import { terminalSafeText, terminalText } from './terminal-text.js';

describe('terminalText', () => {
  it('replaces ESC sequences, C1 CSI, DEL, bell and carriage return with spaces', () => {
    const hostile = 'orders\u001b[2J\u001b]0;pwned\u0007\u009b31m\u007fx\rok';
    const safe = terminalText(hostile);
    expect(safe).not.toMatch(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/);
    expect(safe).toBe('orders [2J ]0;pwned  31m x ok');
  });

  it('keeps tabs, and newlines only when the text may span lines', () => {
    expect(terminalText('a\tb\nc')).toBe('a\tb c');
    expect(terminalText('a\tb\nc\u001b', { multiline: true })).toBe('a\tb\nc ');
  });

  it('leaves printable Unicode alone', () => {
    expect(terminalText('Bestellungen → Kunden · 注文')).toBe('Bestellungen → Kunden · 注文');
  });
});

const ESCAPE = '\u001b]0;pwned\u0007\u001b[2K\u001b[1A\u009b31mfake success';

describe('terminalSafeText', () => {
  it('removes ANSI escapes and other control characters from server text', () => {
    const safe = terminalSafeText(`Denied${ESCAPE}\r\nretry`);
    expect(safe).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(safe).toContain('Denied');
    expect(safe).toContain('fake success');
  });

  it('bounds the length and drops empty or non-string input', () => {
    expect(terminalSafeText('x'.repeat(1000))).toHaveLength(512);
    expect(terminalSafeText('abc', 2)).toBe('ab');
    expect(terminalSafeText('\u001b\u0007')).toBeUndefined();
    expect(terminalSafeText(42)).toBeUndefined();
  });

  it('applies to the hint in Cloud\'s error envelope', () => {
    const details = parseCloudErrorBody(JSON.stringify({ error: { hint: `Sign in${ESCAPE}` } }));
    expect(details.hint).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });
});
