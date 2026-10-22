import Link from 'next/link';

export function AnnouncementBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-[42px] bg-gradient-to-r from-accent via-[#5b61d6] to-accent text-white border-b-2 border-white/20 shadow-lg">
      <Link
        href="/blog/introducing-hypequery-python"
        className="flex h-full min-w-0 items-center justify-center px-4 text-center text-[13px] font-medium transition hover:opacity-90"
      >
        <span className="truncate">
          <span className="font-semibold">hypequery for Python is here</span>: datasets and FastAPI serving for ClickHouse.{' '}
          <span className="underline underline-offset-2">Read the launch post →</span>
        </span>
      </Link>
    </div>
  );
}
