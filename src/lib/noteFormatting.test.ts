import { expect, it } from 'vitest';
import { formatNote } from './noteFormatting';

it('formats a selected phrase without changing surrounding notes', () => {
  const result = formatNote('A decision today', 2, 10, 'bold');
  expect(result.text).toBe('A **decision** today');
  expect(result.text.slice(result.start, result.end)).toBe('decision');
});

it('formats whole selected lines as a list and preserves later paragraphs', () => {
  const result = formatNote('Intro\nCall client\nSend quote\n\nNext paragraph', 6, 28, 'numbered');
  expect(result.text).toBe('Intro\n1. Call client\n2. Send quote\n\nNext paragraph');
});

it('adds a link with the URL selected for replacement', () => {
  const result = formatNote('Read proposal', 5, 13, 'link');
  expect(result.text).toBe('Read [proposal](https://)');
  expect(result.text.slice(result.start, result.end)).toBe('https://');
});

it('inserts formatting placeholders in an empty note', () => {
  expect(formatNote('', 0, 0, 'italic').text).toBe('*italic text*');
  expect(formatNote('', 0, 0, 'heading').text).toBe('## ');
});
