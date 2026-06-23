'use client';

import { useState } from 'react';

const DEFAULT_COMMAND = 'npx @hypequery/cli init';

export function InstallCommand({
  command = DEFAULT_COMMAND,
  className = '',
}: {
  command?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`group relative inline-flex items-center gap-2.5 px-4 py-2.5 bg-bg-card border border-border-strong rounded-lg font-mono text-[14px] text-text hover:border-text transition hover:-translate-y-px ${className}`}
    >
      <span className="text-text-muted select-none">$</span>
      <span className="font-medium">{command}</span>
      <svg
        className="w-4 h-4 text-text-dim group-hover:text-text transition"
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
