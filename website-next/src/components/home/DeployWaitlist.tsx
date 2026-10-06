'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const FEATURE_OPTIONS = [
  'Hosted APIs',
  'Hosted MCP',
  'Embeddable chat',
  'Embeddable dashboards',
  'Something else',
] as const;

export function DeployWaitlist({ location, className, compactLabel = false }: { location: string; className?: string; compactLabel?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The dialog renders into <body> so it looks the same wherever it is opened from.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button type="button" className={className} onClick={() => dialogRef.current?.showModal()}>
        {compactLabel ? <><span className="nav-desktop-only">Get cloud access</span><span className="nav-mobile-only">Cloud access</span></> : 'Get cloud access'} <span aria-hidden="true">→</span>
      </button>
      {mounted && createPortal(<dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,560px)] overflow-y-auto rounded-2xl border border-border-strong bg-bg-card p-0 text-left text-base font-normal text-text shadow-2xl backdrop:bg-black/40" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">hypequery Cloud</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">Get early access to deploy.</h2></div>
            <button type="button" aria-label="Close waitlist form" className="text-text-muted" onClick={() => dialogRef.current?.close()}>✕</button>
          </div>
          <p className="mt-3 text-sm leading-6 text-text-muted">Cloud deployment is coming soon. Join the waitlist and we&apos;ll reach out when your project can go live.</p>
          <form action="https://formspree.io/f/mzdwnylk" method="POST" className="mt-6">
            <label htmlFor={`deploy-email-${location}`} className="text-sm font-semibold">Work email</label>
            <input id={`deploy-email-${location}`} name="email" type="email" required placeholder="you@company.com" className="mt-2 w-full rounded-lg border border-border-strong bg-bg px-4 py-3 text-sm outline-none focus:border-accent" />
            <div className="mt-5 flex items-center gap-2">
              <input id={`design-partner-${location}`} name="design_partner" type="checkbox" value="yes" className="h-4 w-4 shrink-0 accent-accent" />
              <label htmlFor={`design-partner-${location}`} className="text-sm text-text">I&apos;d like to be a design partner</label>
              <span className="group relative inline-flex">
                <button type="button" aria-describedby={`design-partner-tip-${location}`} className="flex items-center rounded text-text-muted transition hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <Info className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">What does being a design partner mean?</span>
                </button>
                <span id={`design-partner-tip-${location}`} role="tooltip" className="pointer-events-none invisible absolute left-1/2 top-full -translate-x-1/2 z-20 mt-2 w-[min(260px,75vw)] rounded-lg border border-border-strong bg-bg-card p-3 text-xs leading-5 text-text opacity-0 shadow-xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  Help shape the Cloud roadmap. We&apos;ll reach out to arrange a design discussion.
                </span>
              </span>
            </div>
            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">What features do you most need?</legend>
              <p className="mt-1 text-xs text-text-muted">Pick as many as you like.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {FEATURE_OPTIONS.map((option) => (
                  <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-alt/50 px-3 py-2 text-xs leading-4 text-text transition hover:border-border-strong has-[:checked]:border-accent">
                    <input
                      type="checkbox"
                      name="features"
                      value={option}
                      className="h-4 w-4 shrink-0 accent-accent"
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={`deploy-context-${location}`} className="mt-6 block text-sm font-semibold">Anything else we should know?</label>
            <textarea id={`deploy-context-${location}`} name="additional_context" rows={3} placeholder="Your use case, or what you picked &quot;Something else&quot; for…" className="mt-2 w-full resize-y rounded-lg border border-border-strong bg-bg px-4 py-3 text-sm outline-none placeholder:text-text-dim focus:border-accent" />
            <input type="hidden" name="source" value={`homepage-deploy-${location}`} />
            <button type="submit" className="mt-4 w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 dark:text-[#0c0e14]">Join the cloud waitlist →</button>
          </form>
        </div>
      </dialog>, document.body)}
    </>
  );
}
