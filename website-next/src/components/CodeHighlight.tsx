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
      themes: ['github-dark'],
      langs: [language],
    }).then((highlighter) => {
      const lang = language === 'http' ? 'javascript' : language;
      const result = highlighter.codeToHtml(code.trim(), {
        lang: lang as any,
        theme: 'github-dark',
      });
      setHtml(result);
    });
  }, [code, language]);

  if (!html) {
    return (
      <pre className="overflow-x-auto">
        <code className="text-xs text-emerald-100">{code.trim()}</code>
      </pre>
    );
  }

  return (
    <div
      className="overflow-x-auto shiki text-xs"
      style={{ background: 'transparent' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
