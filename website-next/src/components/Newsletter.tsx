'use client';

export default function Newsletter() {
  return (
    <div className="mb-20 flex justify-center">
      <div className="w-full max-w-3xl rounded-lg border border-border bg-bg-card p-6 text-text shadow-card">
        <div className="mb-4 text-left">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-accent">
            Join our newsletter
          </p>
          <p className="text-text-muted">
            Steal the exact query patterns, cache plays, and architecture
            shortcuts behind sub-second analytics. 5 minute read, every
            Friday.
          </p>
        </div>
        <div className="w-full">
          <iframe
            src="https://subscribe-forms.beehiiv.com/db9fcd69-8fa2-4fa1-a5f6-3e89edc605ed"
            className="beehiiv-embed"
            data-test-id="beehiiv-embed"
            frameBorder="0"
            scrolling="no"
            style={{
              width: '908px',
              height: '100px',
              margin: '0',
              borderRadius: '0 !important',
              backgroundColor: 'transparent',
              boxShadow: '0 0 #0000',
              maxWidth: '100%',
            }}
          />
        </div>
      </div>
    </div>
  );
}
