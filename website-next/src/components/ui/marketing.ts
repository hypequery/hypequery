// Shared classes for the homepage and the lead pages, so every marketing page reads as one site.
// Values come from the homepage; change them here rather than in a page.

export const marketing = {
  container: 'mx-auto max-w-[1280px] px-5 sm:px-8',
  eyebrow: 'font-mono text-xs text-accent',
  heroTitle: 'text-[clamp(2.25rem,4.6vw,4rem)] font-normal leading-[1.04] tracking-[-0.05em] text-text',
  heroLead: 'text-body-lg text-text-muted',
  sectionTitle: 'home-section-title text-text',
  sectionLead: 'text-sm leading-6 text-text-muted sm:text-base',
  cardTitle: 'text-xl font-medium tracking-tight text-text',
  card: 'rounded-xl border border-border bg-bg-card p-6 shadow-card',
  band: 'border-y border-border bg-bg-alt/60',
  primaryButton:
    'inline-flex min-h-12 items-center gap-3 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 dark:text-[#0c0e14]',
  secondaryButton:
    'inline-flex min-h-12 items-center gap-3 rounded-lg border border-border-strong bg-bg-card px-5 text-sm font-semibold text-text transition hover:-translate-y-0.5 hover:border-text',
} as const;
