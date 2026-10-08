export type NoteFormat = 'bold' | 'italic' | 'heading' | 'bullets' | 'numbered' | 'quote' | 'link';

export function formatNote(text: string, start: number, end: number, format: NoteFormat) {
  const selection = text.slice(start, end);
  if (format === 'bold' || format === 'italic' || format === 'link') {
    const placeholder = selection || (format === 'link' ? 'link text' : `${format} text`);
    const marker = format === 'bold' ? '**' : '*';
    const replacement = format === 'link' ? `[${placeholder}](https://)` : `${marker}${placeholder}${marker}`;
    const selectionStart = start + (format === 'link' ? placeholder.length + 3 : marker.length);
    return {
      text: text.slice(0, start) + replacement + text.slice(end),
      start: selectionStart,
      end: selectionStart + (format === 'link' ? 8 : placeholder.length),
    };
  }
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', Math.max(start, end - 1));
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const prefix = (index: number) => format === 'heading' ? '## ' : format === 'quote' ? '> ' : format === 'numbered' ? `${index + 1}. ` : '- ';
  const replacement = lines.map((line, index) => `${prefix(index)}${line}`).join('\n');
  return {
    text: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    start: lineStart, end: lineStart + replacement.length,
  };
}
