import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { NoteContent } from './NoteContent';

const render = (text: string) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<NoteContent text={text} />);
  return container;
};

it('renders pasted Markdown as headings, bold, lists and distinct paragraphs', () => {
  const content = render('## Meeting notes\n\n**Decision:** proceed\nNext line\n\n- Call client\n- Send quote\n\nFinal paragraph');
  expect(content.querySelector('h2')?.textContent).toBe('Meeting notes');
  expect(content.querySelector('strong')?.textContent).toBe('Decision:');
  expect(content.querySelectorAll('li')).toHaveLength(2);
  expect(content.querySelector('p')?.textContent).toContain('proceed\nNext line');
  expect(content.querySelector('p:last-child')?.textContent).toBe('Final paragraph');
});

it('keeps legacy plain text and blank lines readable', () => {
  const content = render('First line\nSecond line\n\nNew paragraph');
  expect(content.querySelectorAll('p')).toHaveLength(2);
  expect(content.querySelector('p')?.textContent).toBe('First line\nSecond line');
  expect(content.firstElementChild?.className).toContain('whitespace-pre-wrap');
});

it('does not execute pasted HTML or produce unsafe links', () => {
  const content = render('<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n[proposal](https://example.com/proposal)');
  expect(content.querySelector('script')).toBeNull();
  expect(content.querySelectorAll('a')).toHaveLength(1);
  expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.com/proposal');
  expect(content.querySelector('a')?.getAttribute('rel')).toContain('noopener');
});
