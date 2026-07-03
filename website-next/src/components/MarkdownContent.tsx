import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeHighlight from '@/components/CodeHighlight';

/**
 * Shared markdown renderer for blog posts, compare articles, and CMS previews.
 * Adds GFM support (tables, strikethrough, task lists) on top of the standard
 * code highlighting, and renders tables with design-system tokens so they
 * follow the active theme.
 */
export default function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const code = String(children).replace(/\n$/, '');

          if (!match) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }

          return <CodeHighlight code={code} language={match[1]} />;
        },
        table({ children }) {
          return (
            <div className="not-prose my-8 overflow-x-auto rounded-lg border border-border bg-bg-card shadow-card">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="bg-bg-alt/60">{children}</thead>;
        },
        tbody({ children }) {
          return <tbody className="[&>tr:last-child>td]:border-b-0">{children}</tbody>;
        },
        th({ children }) {
          return (
            <th className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-text-dim">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border-b border-border px-4 py-3 align-top text-sm leading-6 text-text-muted first:font-medium first:text-text">
              {children}
            </td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
