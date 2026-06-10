import Link from 'next/link';

export function AnnouncementBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-accent via-[#5b61d6] to-accent text-white py-2.5 border-b-2 border-white/20 shadow-lg">
      <Link
        href="/docs/datasets/overview"
        className="block px-4 text-center text-[13px] font-medium transition hover:opacity-90"
      >
        🚀 <span className="font-semibold">Datasets are live</span> — the semantic layer for ClickHouse, written in TypeScript.{' '}
        <span className="underline underline-offset-2">Read the launch post →</span>
      </Link>
    </div>
  );
}
