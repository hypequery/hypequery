'use client';

import { useEffect, useState } from 'react';
import { createHighlighter } from 'shiki';

interface CodeHighlightProps {
  code: string;
  language?: string;
}

export default function CodeHighlight({ code, language = 'ts' }: CodeHighlightProps) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    createHighlighter({
      themes: ['aurora-x'],
      langs: [language],
    }).then((highlighter) => {
      const lang = language === 'http' ? 'javascript' : language;
      const result = highlighter.codeToHtml(code.trim(), {
        lang: lang,
        theme: 'aurora-x',
      });
      setHtml(result);
    });
  }, [code, language]);

  return (
    <div
      className="overflow-x-auto text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
