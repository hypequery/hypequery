'use client';

import { useEffect, useState } from 'react';
import { createHighlighter } from 'shiki';

interface CodeHighlightProps {
  code: string;
  language?: string;
  className?: string;
}

export default function CodeHighlight({ code, language = 'ts', className = '' }: CodeHighlightProps) {
  const [html, setHtml] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const updateTheme = () => {
      const root = document.documentElement;
      // Check both class-based and attribute-based theme
      const hasLightClass = root.classList.contains('light');
      const hasDarkClass = root.classList.contains('dark');
      const dataTheme = root.getAttribute('data-theme');

      let nextTheme: 'light' | 'dark' = 'dark';
      if (hasLightClass || dataTheme === 'light') {
        nextTheme = 'light';
      } else if (hasDarkClass || dataTheme === 'dark') {
        nextTheme = 'dark';
      }

      setTheme(nextTheme);
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    createHighlighter({
      themes: ['aurora-x', 'github-light'],
      langs: [language],
    }).then((highlighter) => {
      const lang = language === 'http' ? 'javascript' : language;
      const result = highlighter.codeToHtml(code.trim(), {
        lang: lang,
        theme: theme === 'light' ? 'github-light' : 'aurora-x',
      });
      setHtml(result);
    });
  }, [code, language, theme]);

  return (
    <div
      className={`not-prose overflow-x-auto text-sm [&_.shiki]:bg-transparent! [&_.shiki]:p-0! [&_pre]:m-0 [&_pre]:bg-transparent ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
