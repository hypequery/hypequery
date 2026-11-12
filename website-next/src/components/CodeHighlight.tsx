'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { createHighlighter } from 'shiki';

interface CodeHighlightProps {
  code: string;
  language?: string;
  className?: string;
}

export default function CodeHighlight({ code, language = 'ts', className = '' }: CodeHighlightProps) {
  const [html, setHtml] = useState<string>('');
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    createHighlighter({
      themes: ['aurora-x', 'github-light'],
      langs: [language],
    }).then((highlighter) => {
      const lang = language === 'http' ? 'javascript' : language;
      const result = highlighter.codeToHtml(code.trim(), {
        lang: lang,
        theme: resolvedTheme === 'light' ? 'github-light' : 'aurora-x',
      });
      setHtml(result);
    });
  }, [code, language, resolvedTheme]);

  const classes = `not-prose overflow-x-auto text-sm font-mono [&_.shiki]:bg-transparent! [&_.shiki]:p-0! [&_.shiki]:font-mono! [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:font-mono! [&_code]:font-mono! [&_span]:font-mono! ${className}`;

  // Until Shiki loads (and in the server-rendered HTML), show the plain code so
  // crawlers, AI fetchers and no-JS readers still get it.
  if (!html) {
    return (
      <div className={classes}>
        <pre>
          <code>{code.trim()}</code>
        </pre>
      </div>
    );
  }

  return <div className={classes} dangerouslySetInnerHTML={{ __html: html }} />;
}
