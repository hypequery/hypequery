import type { ReactNode } from 'react';

/** Renders `backtick` spans in a plain string as inline code, so data tables can stay plain strings. */
export function withInlineCode(text: string, className = 'font-mono text-[0.92em] text-text'): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className={className}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}
