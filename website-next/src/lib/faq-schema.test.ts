import assert from 'node:assert/strict';
import { test } from 'node:test';
import { questionCardsAsFaq, uniqueFaq } from './faq-schema';

test('only question cards become FAQ items, without inline-code backticks', () => {
  const items = questionCardsAsFaq([
    { title: 'What is the ClickHouse API?', copy: 'Its HTTP interface on port `8123`.' },
    { title: 'ClickHouse API with OpenAPI docs', copy: 'Not a question.' },
  ]);
  assert.deepEqual(items, [{ question: 'What is the ClickHouse API?', answer: 'Its HTTP interface on port 8123.' }]);
});

test('repeated questions are dropped, case-insensitively', () => {
  const items = uniqueFaq([
    { question: 'Is it open source?', answer: 'Yes.' },
    { question: 'is it open source?', answer: 'Duplicate.' },
  ]);
  assert.equal(items.length, 1);
});
