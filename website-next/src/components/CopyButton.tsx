'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`relative inline-flex items-center justify-center gap-2 border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-gray-100 transition hover:bg-white/20 ${className}`}
      aria-label="Copy to clipboard"
    >
      <span className={`flex items-center gap-1 transition-opacity duration-200 ${copied ? 'opacity-0' : 'opacity-100'}`}>
        <Copy className="h-3.5 w-3.5" />
        Copy
      </span>
      <span className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-1 bg-emerald-500/10 text-emerald-200 transition-opacity duration-200 ${copied ? 'opacity-100' : 'opacity-0'}`}>
        <Check className="h-3.5 w-3.5" />
        Copied!
      </span>
    </button>
  );
}
