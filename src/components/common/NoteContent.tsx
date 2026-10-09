import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export function NoteContent({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn(
      'min-w-0 text-sm leading-7 [overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
      '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold',
      '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li]:whitespace-pre-wrap [&_li>p]:my-1',
      '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
      '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_pre_code]:p-0',
      '[&_hr]:my-4 [&_th]:border [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:p-2 [&_input]:mr-2', className,
    )}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
        a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-text underline underline-offset-4">{children}</a> : <span>{children}</span>,
        img: ({ alt }) => <span className="text-muted-foreground">{alt || 'Image'}</span>,
        table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse">{children}</table></div>,
      }}>{text}</ReactMarkdown>
    </div>
  );
}
