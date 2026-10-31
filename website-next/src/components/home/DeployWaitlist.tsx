'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Info } from 'lucide-react';

const FORM_ACTION = 'https://formspree.io/f/mzdwnylk';
const OPEN_EVENT = 'hypequery:open-waitlist';

const FEATURE_OPTIONS = [
  'Hosted APIs',
  'Hosted MCP',
  'Embeddable chat',
  'Embeddable dashboards',
  'AI dataset authoring',
  'Something else',
] as const;

// Tells us which way to build people prefer, so the homepage can lead with it.
const AUTHORING_OPTIONS = [
  ['ai', 'With AI, in cloud'],
  ['code', 'In code (TypeScript or Python)'],
  ['both', 'Both'],
  ['unsure', 'Not sure yet'],
] as const;

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** A button that opens the shared waitlist dialog. `location` records where it was opened from. */
export function DeployWaitlist({ location, className }: { location: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: location }))}>
      Join the cloud waitlist
    </button>
  );
}

/** The one waitlist dialog for the whole site, rendered from the root layout. */
export function WaitlistDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    const open = (event: Event) => {
      // Records the page and button, e.g. `homepage-deploy-hero` or `docs-deploy-cloud-notice`.
      const { pathname } = window.location;
      const page = pathname === '/' ? 'homepage' : pathname.split('/')[1];
      setSource(`${page}-deploy-${(event as CustomEvent<string>).detail}`);
      setStatus('idle');
      dialogRef.current?.showModal();
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setStatus('sending');
    try {
      const response = await fetch(FORM_ACTION, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Waitlist signup failed');
      form.reset();
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="waitlist-title" className="m-auto max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,560px)] overflow-hidden rounded-2xl border border-border-strong bg-bg-card p-0 text-left text-base font-normal text-text shadow-2xl backdrop:bg-black/40" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
      <div className="flex max-h-[calc(100dvh-2rem-2px)] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-8">
          <h2 id="waitlist-title" className="text-2xl font-semibold tracking-tight">{status === 'sent' ? "You're on the list." : 'Get early access to hypequery cloud.'}</h2>
          <button type="button" aria-label="Close waitlist form" className="text-text-muted" onClick={() => dialogRef.current?.close()}>✕</button>
        </div>
        {status === 'sent' ? (
          <div role="status" className="mt-4 overflow-y-auto px-6 pb-6 sm:px-8 sm:pb-8">
            <p className="flex items-start gap-2 text-sm leading-6 text-text-muted"><Check className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />Thanks for signing up. We&apos;ll reach out when your project can go live.</p>
            <button type="button" className="mt-6 w-full rounded-lg border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:border-text" onClick={() => dialogRef.current?.close()}>Close</button>
          </div>
        ) : (
          <>
            <p className="mt-3 shrink-0 px-6 text-sm leading-6 text-text-muted sm:px-8">Cloud hosts the same model you run in your backend, with a managed API and MCP server, versions, and rollback. We&apos;re letting teams in a few at a time. Join the waitlist and we&apos;ll reach out when your project can go live.</p>
            <form action={FORM_ACTION} method="POST" onSubmit={handleSubmit} className="mt-6 flex min-h-0 flex-col">
              <div className="overflow-y-auto px-6 pb-6 sm:px-8">
              <label htmlFor="waitlist-email" className="text-sm font-semibold">Work email</label>
              <input id="waitlist-email" name="email" type="email" required placeholder="you@company.com" className="mt-2 w-full rounded-lg border border-border-strong bg-bg px-4 py-3 text-sm outline-none focus:border-accent" />
              <div className="mt-5 flex items-center gap-2">
                <input id="waitlist-design-partner" name="design_partner" type="checkbox" value="yes" className="h-4 w-4 shrink-0 accent-accent" />
                <label htmlFor="waitlist-design-partner" className="text-sm text-text">I&apos;d like to be a design partner</label>
                <span className="group relative inline-flex">
                  <button type="button" aria-describedby="waitlist-design-partner-tip" className="flex items-center rounded text-text-muted transition hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <Info className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">What does being a design partner mean?</span>
                  </button>
                  <span id="waitlist-design-partner-tip" role="tooltip" className="pointer-events-none invisible absolute right-0 top-full z-20 mt-2 w-[min(260px,75vw)] rounded-lg border border-border-strong bg-bg-card p-3 text-xs leading-5 text-text opacity-0 shadow-xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    Help shape the cloud roadmap. We&apos;ll reach out to arrange a design discussion.
                  </span>
                </span>
              </div>
              <fieldset className="mt-6">
                <legend className="text-sm font-semibold">How do you want to build your analytics layer? <span className="font-normal text-text-muted">(Optional)</span></legend>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {AUTHORING_OPTIONS.map(([value, label]) => (
                    <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-alt/50 px-3 py-2 text-xs leading-4 text-text transition hover:border-border-strong has-[:checked]:border-accent">
                      <input type="radio" name="authoring" value={value} className="h-4 w-4 shrink-0 accent-accent" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="mt-6">
                <legend className="text-sm font-semibold">What features do you most need? <span className="font-normal text-text-muted">(Optional)</span></legend>
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
              <label htmlFor="waitlist-context" className="mt-6 block text-sm font-semibold">Anything else we should know? <span className="font-normal text-text-muted">(Optional)</span></label>
              <textarea id="waitlist-context" name="additional_context" rows={3} placeholder="Your use case, or what you picked &quot;Something else&quot; for…" className="mt-2 w-full resize-y rounded-lg border border-border-strong bg-bg px-4 py-3 text-sm outline-none placeholder:text-text-dim focus:border-accent" />
              <input type="hidden" name="source" value={source} />
              </div>
              <div className="shrink-0 border-t border-border bg-bg-card px-6 py-4 sm:px-8">
                <p className="mb-3 text-xs text-text-muted">Only your email is required. All other questions are optional.</p>
                {status === 'error' && <p role="alert" className="mb-3 text-sm text-[#dc2626]">Something went wrong. Please try again, or <a href="/contact-us" className="underline underline-offset-2">contact us</a>.</p>}
                <button type="submit" disabled={status === 'sending'} className="w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 dark:text-[#0c0e14]">{status === 'sending' ? 'Joining…' : 'Join the cloud waitlist →'}</button>
              </div>
            </form>
          </>
        )}
      </div>
    </dialog>
  );
}
