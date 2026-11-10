'use client';

import { useState } from 'react';
import { trackUmamiEvent } from '@/lib/umami';

const DEFAULT_COMMAND = 'npx @hypequery/cli init';

export function InstallCommand({
  command = DEFAULT_COMMAND,
  className = '',
  variant = 'default',
  location = 'setup_command',
}: {
  command?: string;
  className?: string;
  variant?: 'default' | 'card';
  /** Where the command sits on the page, sent with the `code_copy` event. */
  location?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    trackUmamiEvent('code_copy', {
      kind: 'install',
      method: 'button',
      snippet: command,
      location,
      page: window.location.pathname,
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`group relative inline-flex items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 py-2 text-text transition hover:-translate-y-px hover:border-text ${variant === 'card' ? 'font-sans text-xs' : 'font-mono text-[13px]'} ${className}`}
    >
      <span className="text-text-muted select-none">$</span>
      <span className={`min-w-0 text-left font-medium [overflow-wrap:anywhere] ${variant === 'card' ? 'flex-1' : ''}`}>{command}</span>
      <svg
        className="w-4 h-4 shrink-0 text-text-dim group-hover:text-text transition"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        {copied ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        )}
      </svg>
      {copied && (
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-text text-bg text-xs font-sans font-medium rounded whitespace-nowrap">
          Copied!
        </span>
      )}
    </button>
  );
}
