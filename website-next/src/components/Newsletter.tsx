// Beehiiv subscribe form. Rendered on the blog index and under every post so a
// reader has a way to come back; the form id is the publication's embed form.
const BEEHIIV_FORM_URL = 'https://subscribe-forms.beehiiv.com/db9fcd69-8fa2-4fa1-a5f6-3e89edc605ed';

export default function Newsletter({ className = '' }: { className?: string }) {
  return (
    <section id="newsletter" aria-labelledby="newsletter-title" className={`rounded-2xl border border-border bg-bg-card p-6 shadow-card sm:p-8 ${className}`}>
      <p className="font-mono text-xs text-accent">Newsletter</p>
      <h2 id="newsletter-title" className="mt-2 text-xl font-medium tracking-tight text-text">
        ClickHouse patterns, once a week
      </h2>
      <p className="mt-2 max-w-[560px] text-sm leading-6 text-text-muted">
        Query patterns, modelling decisions, and hypequery releases for teams building analytics on ClickHouse. A five-minute read, no more than weekly.
      </p>
      <iframe
        src={BEEHIIV_FORM_URL}
        title="Subscribe to the hypequery newsletter"
        className="mt-5 block w-full max-w-[640px] border-0"
        style={{ height: '100px', backgroundColor: 'transparent' }}
        scrolling="no"
      />
      <p className="mt-3 text-xs text-text-dim">
        Prefer a feed? <a href="/blog/rss.xml" className="underline underline-offset-2 hover:text-text">Subscribe via RSS</a>.
      </p>
    </section>
  );
}
