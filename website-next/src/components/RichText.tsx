import { Fragment } from 'react';

/** Renders marketing copy, turning `backtick` spans into inline code. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            className="rounded border border-border bg-bg-alt px-1 py-px font-mono text-[0.9em] text-text dark:border-white/10 dark:bg-white/5"
          >
            {part}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
