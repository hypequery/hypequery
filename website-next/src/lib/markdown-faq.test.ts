import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownFaq } from './markdown-faq';

const post = `Intro.

## Quick answers

### What is a \`materialized view\`?

An **insert trigger** that writes to a [target table](/blog/x).

\`\`\`sql
SELECT 1
\`\`\`

### Not a question

Ignored.

### Can I drop it?

Yes, with DROP VIEW.

## Next section

### Outside the section?

Ignored too.
`;

test('extracts questions and plain-text answers from the Quick answers section', () => {
  assert.deepEqual(markdownFaq(post), [
    { question: 'What is a materialized view?', answer: 'An insert trigger that writes to a target table.' },
    { question: 'Can I drop it?', answer: 'Yes, with DROP VIEW.' },
  ]);
});

test('a post without the section has no FAQ', () => {
  assert.deepEqual(markdownFaq('## Intro\n\n### Why?\n\nBecause.'), []);
});
