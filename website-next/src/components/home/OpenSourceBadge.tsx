import { SiGithub } from 'react-icons/si';

/** The "Open source · Apache 2.0" badge linking to the repo, shown above the homepage and lead page headings. */
export function OpenSourceBadge() {
  return (
    <a href="https://github.com/hypequery/hypequery" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-bg-card px-3 font-mono text-xs text-text-muted transition hover:-translate-y-px hover:border-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
      <SiGithub className="h-3.5 w-3.5 text-text" aria-hidden="true" /><span className="font-semibold text-text">Open source</span><span className="border-l border-border pl-2">Apache 2.0</span>
    </a>
  );
}
