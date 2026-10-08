import { useEffect, useId, useRef, useState } from 'react';
import { Bold, Heading2, Italic, Link, List, ListOrdered, Maximize2, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatNote, type NoteFormat } from '@/lib/noteFormatting';
import { NoteContent } from './NoteContent';

const FORMATS = [
  { format: 'bold', label: 'Bold', icon: Bold },
  { format: 'italic', label: 'Italic', icon: Italic },
  { format: 'heading', label: 'Heading', icon: Heading2 },
  { format: 'bullets', label: 'Bullet list', icon: List },
  { format: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { format: 'quote', label: 'Quote', icon: Quote },
  { format: 'link', label: 'Insert link', icon: Link },
] as const;

interface NoteEditorProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

export function NoteEditor({ id, label, value, onChange, placeholder, maxLength, disabled }: NoteEditorProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [formatError, setFormatError] = useState('');

  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.max(expanded ? 360 : 220, input.scrollHeight)}px`;
    };
    grow();
    window.addEventListener('resize', grow);
    return () => window.removeEventListener('resize', grow);
  }, [value, expanded, mode]);

  const applyFormat = (format: NoteFormat) => {
    const input = textarea.current;
    if (!input || disabled) return;
    const next = formatNote(value, input.selectionStart, input.selectionEnd, format);
    if (maxLength && next.text.length > maxLength) {
      setFormatError(`This note can contain up to ${maxLength.toLocaleString()} characters.`);
      return;
    }
    setFormatError('');
    onChange(next.text);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.start, next.end);
    });
  };

  const editor = (
    <div className="min-w-0 overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 p-2">
        <div className="flex items-center gap-1" aria-label="Note view">
          <Button type="button" size="sm" variant={mode === 'write' ? 'secondary' : 'ghost'} aria-pressed={mode === 'write'} onClick={() => setMode('write')}>Write</Button>
          <Button type="button" size="sm" variant={mode === 'preview' ? 'secondary' : 'ghost'} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</Button>
        </div>
        {!expanded && <Button ref={expandButton} type="button" size="sm" variant="ghost" onClick={() => setExpanded(true)}><Maximize2 />Expand editor</Button>}
      </div>
      {mode === 'write' ? (
        <>
          <div className="flex flex-wrap gap-1 border-b px-2 py-1" role="group" aria-label="Note formatting">
            {FORMATS.map(({ format, label: buttonLabel, icon: Icon }) => (
              <Button key={format} type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={buttonLabel} title={buttonLabel} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(format)}><Icon /></Button>
            ))}
          </div>
          <Textarea ref={textarea} id={inputId} aria-label={label} placeholder={placeholder} value={value} maxLength={maxLength} disabled={disabled}
            className="min-h-[220px] resize-none overflow-hidden rounded-none border-0 p-4 text-base leading-7 shadow-none focus-visible:ring-inset sm:text-sm"
            onChange={(event) => { setFormatError(''); onChange(event.target.value); }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && !event.altKey && ['b', 'i'].includes(event.key.toLowerCase())) {
                event.preventDefault(); applyFormat(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
              }
            }}
          />
          {value.trim() && <details className="border-t p-4" open>
            <summary className="mb-3 cursor-pointer text-xs font-medium text-muted-foreground">Formatted preview</summary>
            <NoteContent text={value} />
          </details>}
        </>
      ) : (
        <div className="min-h-[220px] p-4" role="region" aria-label={`${label} preview`}>
          {value.trim() ? <NoteContent text={value} /> : <p className="text-sm text-muted-foreground">Your formatted note will appear here.</p>}
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>Use the toolbar or paste Markdown. Line breaks are preserved.</span>
        <span>{value.length.toLocaleString()}{maxLength ? ` / ${maxLength.toLocaleString()}` : ''} characters</span>
      </div>
      {formatError && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{formatError}</p>}
    </div>
  );

  return (
    <div className="min-w-0">
      {!expanded ? editor : <p className="rounded-xl border p-4 text-sm text-muted-foreground">Editing in expanded view.</p>}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-h-[92dvh] w-[calc(100%_-_1rem)] max-w-5xl overflow-y-auto rounded-xl p-4 sm:p-6"
          onCloseAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => (textarea.current || expandButton.current)?.focus()); }}>
          <DialogHeader className="pr-8">
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>Room to write and review. Close this view to return to the record and save your note.</DialogDescription>
          </DialogHeader>
          {expanded && editor}
          <Button type="button" onClick={() => setExpanded(false)}>Done editing</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
