'use client';

export default function Newsletter() {
  return (
    <div className="mb-20 flex justify-center">
      <div className="w-full max-w-3xl rounded-3xl border border-gray-200 bg-white p-6 text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 text-left">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-indigo-800 dark:text-indigo-200">
            Join our newsletter
          </p>
          <p className="text-indigo-800 dark:text-indigo-200">
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
