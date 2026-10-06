'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: ['aurora-x', 'github-light'],
    langs: ['typescript', 'python'],
  });
  return highlighterPromise;
}

/**
 * A syntax-highlighted code editor: a transparent textarea laid exactly over
 * Shiki output, so the code stays highlighted while it is edited.
 */
export function EditableCode({
  value,
  onChange,
  language,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  language: 'typescript' | 'python';
  label: string;
}) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let active = true;
    getHighlighter().then((instance) => {
      if (active) setHighlighter(instance);
    });
    return () => {
      active = false;
    };
  }, []);

  // A trailing newline keeps the highlighted layer as tall as the textarea.
  const html = useMemo(
    () => highlighter?.codeToHtml(`${value}\n`, {
      lang: language,
      theme: resolvedTheme === 'light' ? 'github-light' : 'aurora-x',
    }),
    [highlighter, value, language, resolvedTheme],
  );

  return (
    <div className="editable-code min-h-[280px] overflow-x-auto font-mono text-[11px] leading-[1.75] sm:text-xs">
      <div className="relative w-max min-w-full">
        {html
          ? <div aria-hidden="true" className="pointer-events-none [&_.shiki]:bg-transparent! [&_pre]:m-0" dangerouslySetInnerHTML={{ __html: html }} />
          : <pre aria-hidden="true" className="m-0 text-text">{`${value}\n`}</pre>}
        <textarea
          aria-label={label}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || event.shiftKey) return;
            event.preventDefault();
            const target = event.currentTarget;
            const { selectionStart, selectionEnd } = target;
            const indent = language === 'python' ? '    ' : '  ';
            onChange(`${value.slice(0, selectionStart)}${indent}${value.slice(selectionEnd)}`);
            requestAnimationFrame(() => target.setSelectionRange(selectionStart + indent.length, selectionStart + indent.length));
          }}
          className="absolute inset-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0 font-mono text-transparent caret-[var(--text)] outline-none selection:bg-accent/30"
        />
      </div>
    </div>
  );
}
