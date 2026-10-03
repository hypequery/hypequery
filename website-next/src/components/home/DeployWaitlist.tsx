'use client';

import { useRef } from 'react';
import { Info } from 'lucide-react';

const CLOUD_PRIORITIES = [
  ['Hosted REST APIs', 'cloud_feature_hosted_rest_apis'],
  ['Hosted MCP', 'cloud_feature_hosted_mcp'],
  ['Managed deployments', 'cloud_feature_managed_deployments'],
  ['Tenant isolation', 'cloud_feature_tenant_isolation'],
  ['Releases and rollback', 'cloud_feature_releases_and_rollback'],
  ['Access controls', 'cloud_feature_access_controls'],
  ['Usage and observability', 'cloud_feature_usage_and_observability'],
] as const;

export function DeployWaitlist({ location, className, compactLabel = false }: { location: string; className?: string; compactLabel?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className={className} onClick={() => dialogRef.current?.showModal()}>
        {compactLabel ? <><span className="nav-desktop-only">Get cloud access</span><span className="nav-mobile-only">Cloud access</span></> : 'Get cloud access'} <span aria-hidden="true">→</span>
      </button>
      <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,560px)] overflow-y-auto rounded-2xl border border-border-strong bg-bg-card p-0 text-text shadow-2xl backdrop:bg-black/40" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
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
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center text-text-muted transition hover:text-text [&::-webkit-details-marker]:hidden">
                  <Info className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">What does being a design partner mean?</span>
                </summary>
                <div className="absolute right-0 top-full z-20 mt-2 w-[min(260px,75vw)] rounded-lg border border-border-strong bg-bg-card p-3 text-xs leading-5 text-text shadow-xl">
                  Help shape the Cloud roadmap. We&apos;ll reach out to arrange a design discussion.
                </div>
              </details>
            </div>
            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">Which Cloud features matter most to you?</legend>
              <p className="mt-1 text-xs text-text-muted">Select any that matter to you. Optional.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {CLOUD_PRIORITIES.map(([feature, fieldName]) => (
                  <label key={feature} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-alt/50 px-3 py-2 text-xs leading-4 text-text transition hover:border-border-strong">
                    <input
                      type="checkbox"
                      name={fieldName}
                      value={feature}
                      className="h-4 w-4 shrink-0 accent-accent"
                    />
                    <span>{feature}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={`deploy-context-${location}`} className="mt-6 block text-sm font-semibold">Anything else we should know?</label>
            <textarea id={`deploy-context-${location}`} name="additional_context" rows={3} placeholder="Your use case, timeline, or anything else…" className="mt-2 w-full resize-y rounded-lg border border-border-strong bg-bg px-4 py-3 text-sm outline-none placeholder:text-text-dim focus:border-accent" />
            <input type="hidden" name="source" value={`homepage-deploy-${location}`} />
            <button type="submit" className="mt-4 w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 dark:text-[#0c0e14]">Join the cloud waitlist →</button>
          </form>
        </div>
      </dialog>
    </>
  );
}
