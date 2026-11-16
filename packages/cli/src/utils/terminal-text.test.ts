import { describe, expect, it } from 'vitest';
import { terminalText } from './terminal-text.js';

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
