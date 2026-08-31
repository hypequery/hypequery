import { describe, expect, it } from 'vitest';
import { formatGeneratedFileDiff } from './generated-file-diff.js';

describe('formatGeneratedFileDiff', () => {
  it('returns an empty string for identical contents', () => {
    expect(formatGeneratedFileDiff('same\n', 'same\n', 'datasets.ts')).toBe('');
  });

  it('formats the changed region as a unified diff', () => {
    expect(formatGeneratedFileDiff(
      'header\nold definition\nfooter\n',
      'header\nnew definition\nfooter\n',
      'analytics/datasets.ts',
    )).toBe([
      '--- analytics/datasets.ts',
      '+++ analytics/datasets.ts (generated)',
      '@@ -1,4 +1,4 @@',
      ' header',
      '-old definition',
      '+new definition',
      ' footer',
      ' ',
    ].join('\n'));
  });

  it('keeps trailing-newline-only changes visible', () => {
    expect(formatGeneratedFileDiff('same', 'same\n', 'datasets.ts')).toContain('\n+');
  });
});
