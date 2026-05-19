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

  return (
    <div
      className={`not-prose overflow-x-auto text-sm [&_.shiki]:bg-transparent! [&_.shiki]:p-0! [&_pre]:m-0 [&_pre]:bg-transparent ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
