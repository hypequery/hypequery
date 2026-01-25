import { useEffect, useRef, useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import { cn } from '@/lib/utils';

interface SQLViewerProps {
  sql: string;
  className?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  wrap?: boolean;
}

/**
 * SQL syntax highlighting component using Prism.js.
 */
export function SQLViewer({
  sql,
  className,
  showLineNumbers = false,
  maxHeight = '400px',
  wrap = false,
}: SQLViewerProps) {
  const codeRef = useRef<HTMLElement>(null);

  // Format SQL for display
  const formattedSQL = useMemo(() => {
    return sql.trim();
  }, [sql]);

  // Apply Prism highlighting
  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [formattedSQL]);

  // Split into lines for line numbers
  const lines = formattedSQL.split('\n');

  if (showLineNumbers) {
    return (
      <div
        className={cn(
          'relative rounded-md bg-muted font-mono text-sm overflow-auto',
          className
        )}
        style={{ maxHeight }}
      >
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="hover:bg-muted-foreground/5">
                <td className="select-none px-3 py-0.5 text-right text-muted-foreground border-r border-border sticky left-0 bg-muted">
                  {index + 1}
                </td>
                <td className={cn('px-3 py-0.5', wrap ? 'whitespace-pre-wrap' : 'whitespace-pre')}>
                  <code
                    ref={index === 0 ? codeRef : undefined}
                    className="language-sql"
                    dangerouslySetInnerHTML={{
                      __html: Prism.highlight(line, Prism.languages.sql, 'sql'),
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md bg-muted overflow-auto',
        className
      )}
      style={{ maxHeight }}
    >
      <pre className={cn(
        'p-4 font-mono text-sm',
        wrap ? 'whitespace-pre-wrap' : 'whitespace-pre'
      )}>
        <code ref={codeRef} className="language-sql">
          {formattedSQL}
        </code>
      </pre>
    </div>
  );
}

/**
 * Inline SQL display for compact views.
 */
export function SQLInline({
  sql,
  maxLength = 100,
  className,
}: {
  sql: string;
  maxLength?: number;
  className?: string;
}) {
  const truncated = sql.length > maxLength ? sql.slice(0, maxLength) + '...' : sql;
  const highlighted = Prism.highlight(truncated, Prism.languages.sql, 'sql');

  return (
    <code
      className={cn('font-mono text-xs whitespace-nowrap', className)}
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

export default SQLViewer;
